import * as oauth from "oauth4webapi";
import {
  type MooAccountError,
  type MooAccountErrorCode,
  type MooAccountProfile,
  type MooAccountState,
  unavailableMooAccountState,
} from "../shared/accountMessages";
import type { MooAccountSessionStore, PersistedMooAccountSession } from "./accountSessionStore";

export type MooAccountAuthConfig = {
  issuer: string;
  clientId: string;
  audience: string;
};

type LaunchWebAuthFlow = (details: chrome.identity.WebAuthFlowDetails) => Promise<string | undefined>;

export type MooAccountAuthDependencies = {
  sessionStore: MooAccountSessionStore;
  launchWebAuthFlow: LaunchWebAuthFlow;
  getRedirectUrl: () => string;
  fetch: typeof fetch;
  hasDataConsent?: () => Promise<boolean>;
  now?: () => number;
};

const AUTH_SCOPES = ["openid", "profile", "email", "offline_access"];
const REFRESH_WINDOW_MS = 60_000;
const FALLBACK_ACCESS_TOKEN_LIFETIME_MS = 5 * 60_000;
const NETWORK_TIMEOUT_MS = 15_000;

export class MooAccountAuthController {
  private readonly now: () => number;
  private readonly oauthFetch: typeof fetch;
  private discoveryPromise: Promise<oauth.AuthorizationServer> | undefined;
  private signInPromise: Promise<MooAccountState> | undefined;
  private signOutPromise: Promise<MooAccountState> | undefined;
  private refreshInFlight:
    | {
        refreshToken: string;
        generation: number;
        promise: Promise<PersistedMooAccountSession>;
      }
    | undefined;
  private sessionGeneration = 0;
  private minimumCleanupRevocationGeneration = 0;
  private storageMutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly config: MooAccountAuthConfig | null,
    private readonly dependencies: MooAccountAuthDependencies,
  ) {
    this.now = dependencies.now || Date.now;
    this.oauthFetch = timeoutFetch(dependencies.fetch, NETWORK_TIMEOUT_MS);
  }

  async getState(): Promise<MooAccountState> {
    if (!this.config) {
      await this.forgetSession();
      return unavailableMooAccountState();
    }
    if (this.signOutPromise) return publicSignedOutState();
    if (!(await this.hasDataConsent())) {
      await this.forgetSession();
      return publicSignedOutState();
    }
    const session = await this.activeSession();
    return session ? publicSignedInState(session) : publicSignedOutState();
  }

  async initialize(): Promise<void> {
    if (!this.config || !(await this.hasDataConsent())) await this.forgetSession();
  }

  signIn(): Promise<MooAccountState> {
    if (!this.config) {
      return Promise.reject(
        new MooAccountAuthError("not_configured", "Moo Account sign-in is not configured in this build."),
      );
    }
    if (this.signInPromise) return this.signInPromise;

    const generation = ++this.sessionGeneration;
    this.minimumCleanupRevocationGeneration = generation;
    const pendingSignOut = this.signOutPromise;
    const operation = (pendingSignOut ? pendingSignOut.catch(() => undefined) : Promise.resolve()).then(() =>
      this.performSignIn(generation),
    );
    const promise = operation.finally(() => {
      if (this.signInPromise === promise) this.signInPromise = undefined;
    });
    this.signInPromise = promise;
    return promise;
  }

  signOut(): Promise<MooAccountState> {
    return this.endSession(true);
  }

  forgetSession(): Promise<MooAccountState> {
    return this.endSession(false);
  }

  private endSession(revoke: boolean): Promise<MooAccountState> {
    if (this.signOutPromise) {
      if (!revoke) {
        this.minimumCleanupRevocationGeneration = Math.max(
          this.minimumCleanupRevocationGeneration,
          this.sessionGeneration + 1,
        );
      }
      return this.signOutPromise;
    }

    const generation = ++this.sessionGeneration;
    if (!revoke) this.minimumCleanupRevocationGeneration = generation + 1;
    const operation = this.performSignOut(revoke);
    const promise = operation.finally(() => {
      if (this.signOutPromise === promise) this.signOutPromise = undefined;
    });
    this.signOutPromise = promise;
    return promise;
  }

  private async performSignOut(revoke: boolean): Promise<MooAccountState> {
    const session = await this.runStorageMutation(async () => {
      const current = await this.dependencies.sessionStore.get();
      await this.dependencies.sessionStore.clear();
      return current;
    });

    if (revoke && this.config && session && sessionMatchesConfig(session, this.config)) {
      await this.revokeSession(session).catch(() => undefined);
    }

    return this.config ? publicSignedOutState() : unavailableMooAccountState();
  }

  private async performSignIn(generation: number): Promise<MooAccountState> {
    await this.assertSignInCanUseNetwork(generation);
    const config = requireConfig(this.config);
    const authorizationServer = await this.authorizationServer();
    await this.assertSignInCanUseNetwork(generation);
    const client: oauth.Client = { client_id: config.clientId };
    const redirectUri = this.dependencies.getRedirectUrl();
    const codeVerifier = oauth.generateRandomCodeVerifier();
    const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier);
    const state = oauth.generateRandomState();
    const nonce = oauth.generateRandomNonce();

    const authorizationUrl = new URL(authorizationServer.authorization_endpoint as string);
    authorizationUrl.searchParams.set("client_id", client.client_id);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", AUTH_SCOPES.join(" "));
    authorizationUrl.searchParams.set("prompt", "consent");
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("resource", config.audience);

    let callbackValue: string | undefined;
    try {
      callbackValue = await this.dependencies.launchWebAuthFlow({
        interactive: true,
        url: authorizationUrl.toString(),
      });
    } catch (error) {
      if (isUserCancellation(error)) {
        throw new MooAccountAuthError("sign_in_cancelled", "Moo Account sign-in was cancelled.", error);
      }
      throw error;
    }
    if (!callbackValue) {
      throw new MooAccountAuthError("sign_in_cancelled", "Moo Account sign-in was cancelled.");
    }

    await this.assertSignInCanUseNetwork(generation);
    const callbackUrl = validatedCallbackUrl(callbackValue, redirectUri);
    const callbackParameters = oauth.validateAuthResponse(authorizationServer, client, callbackUrl, state);
    const tokenResponse = await oauth.authorizationCodeGrantRequest(
      authorizationServer,
      client,
      oauth.None(),
      callbackParameters,
      redirectUri,
      codeVerifier,
      this.requestOptions({ resource: config.audience }),
    );
    const tokens = await oauth.processAuthorizationCodeResponse(authorizationServer, client, tokenResponse, {
      expectedNonce: nonce,
      requireIdToken: true,
    });
    await this.assertSignInCanUseNetwork(generation);
    await oauth.validateApplicationLevelSignature(
      authorizationServer,
      tokenResponse,
      this.requestOptions<oauth.ValidateSignatureOptions>(),
    );
    await this.assertSignInCanUseNetwork(generation);
    const claims = oauth.getValidatedIdTokenClaims(tokens);
    if (!claims?.sub) throw new Error("The Moo Account identity response did not contain a subject.");

    const profile = accountProfile(claims);
    const authenticatedAt = new Date(this.now()).toISOString();
    const session: PersistedMooAccountSession = {
      version: 1,
      issuer: config.issuer,
      clientId: config.clientId,
      audience: config.audience,
      subject: claims.sub,
      displayName: profile.displayName,
      ...(profile.email ? { email: profile.email } : {}),
      emailVerified: profile.emailVerified,
      accessToken: tokens.access_token,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
      tokenType: tokens.token_type,
      scope: tokens.scope || AUTH_SCOPES.join(" "),
      accessTokenExpiresAt: accessTokenExpiry(this.now(), tokens.expires_in),
      authenticatedAt,
    };
    if (!(await this.storeIssuedSession(session, generation))) {
      throw new MooAccountAuthError("sign_in_cancelled", "Moo Account sign-in was cancelled.");
    }
    return publicSignedInState(session);
  }

  private async activeSession(): Promise<PersistedMooAccountSession | null> {
    const config = requireConfig(this.config);
    const generation = this.sessionGeneration;
    const session = await this.dependencies.sessionStore.get();
    if (generation !== this.sessionGeneration) return null;
    if (!session) return null;
    if (!sessionMatchesConfig(session, config)) {
      await this.clearSession(session, generation);
      return null;
    }
    if (session.accessTokenExpiresAt > this.now() + REFRESH_WINDOW_MS) return session;
    if (!session.refreshToken) {
      if (session.accessTokenExpiresAt <= this.now()) {
        await this.clearSession(session, generation);
        return null;
      }
      return session;
    }

    try {
      const refreshed = await this.refreshSessionOnce(session, generation);
      return generation === this.sessionGeneration ? refreshed : null;
    } catch (error) {
      if (generation !== this.sessionGeneration || error instanceof SupersededAccountOperationError) return null;
      if (error instanceof oauth.ResponseBodyError && error.error === "invalid_grant") {
        await this.clearSession(session, generation);
        return null;
      }
      if (error instanceof MooAccountAuthError && error.code === "storage_error") return null;
      // A temporary network failure must not erase an otherwise recoverable login.
      return session;
    }
  }

  private refreshSessionOnce(
    session: PersistedMooAccountSession,
    generation: number,
  ): Promise<PersistedMooAccountSession> {
    const refreshToken = session.refreshToken as string;
    if (this.refreshInFlight?.refreshToken === refreshToken && this.refreshInFlight.generation === generation) {
      return this.refreshInFlight.promise;
    }

    const operation = this.refreshSession(session, generation);
    const promise = operation.finally(() => {
      if (this.refreshInFlight?.promise === promise) this.refreshInFlight = undefined;
    });
    this.refreshInFlight = { refreshToken, generation, promise };
    return promise;
  }

  private async refreshSession(
    session: PersistedMooAccountSession,
    generation: number,
  ): Promise<PersistedMooAccountSession> {
    if (!(await this.sessionOperationCanUseNetwork(generation))) throw new SupersededAccountOperationError();
    const config = requireConfig(this.config);
    const authorizationServer = await this.authorizationServer();
    if (!(await this.sessionOperationCanUseNetwork(generation))) throw new SupersededAccountOperationError();
    const client: oauth.Client = { client_id: config.clientId };
    const response = await oauth.refreshTokenGrantRequest(
      authorizationServer,
      client,
      oauth.None(),
      session.refreshToken as string,
      this.requestOptions({ resource: config.audience }),
    );
    const tokens = await oauth.processRefreshTokenResponse(authorizationServer, client, response);
    const refreshed: PersistedMooAccountSession = {
      ...session,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || session.refreshToken,
      tokenType: tokens.token_type,
      scope: tokens.scope || session.scope,
      accessTokenExpiresAt: accessTokenExpiry(this.now(), tokens.expires_in),
    };
    if (!(await this.storeIssuedSession(refreshed, generation, session))) throw new SupersededAccountOperationError();
    return refreshed;
  }

  private async storeIssuedSession(
    session: PersistedMooAccountSession,
    generation: number,
    previousSession?: PersistedMooAccountSession,
  ): Promise<boolean> {
    try {
      const stored = await this.storeSession(session, generation);
      if (!stored) await this.revokeIssuedSessionIfAllowed(session, generation);
      return stored;
    } catch (error) {
      await this.revokeIssuedSessionIfAllowed(session, generation);
      await this.clearSession(session, generation).catch(() => false);
      if (previousSession) await this.clearSession(previousSession, generation).catch(() => false);
      throw new MooAccountAuthError("storage_error", "Moo Account credentials could not be saved securely.", error);
    }
  }

  private storeSession(session: PersistedMooAccountSession, generation: number): Promise<boolean> {
    return this.runStorageMutation(async () => {
      if (generation !== this.sessionGeneration) return false;
      await this.dependencies.sessionStore.set(session);
      return true;
    });
  }

  private clearSession(session: PersistedMooAccountSession, generation: number): Promise<boolean> {
    return this.runStorageMutation(async () => {
      if (generation !== this.sessionGeneration) return false;
      const current = await this.dependencies.sessionStore.get();
      if (!current || !samePersistedSession(current, session)) return false;
      await this.dependencies.sessionStore.clear();
      return true;
    });
  }

  private runStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageMutation.then(operation, operation);
    this.storageMutation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async revokeIssuedSessionIfAllowed(session: PersistedMooAccountSession, generation: number): Promise<void> {
    if (generation < this.minimumCleanupRevocationGeneration) return;
    await this.revokeSession(session).catch(() => undefined);
  }

  private async assertSignInCanUseNetwork(generation: number): Promise<void> {
    if (generation !== this.sessionGeneration) {
      throw new MooAccountAuthError("sign_in_cancelled", "Moo Account sign-in was cancelled.");
    }
    if (await this.hasDataConsent()) return;
    await this.forgetSession();
    throw new MooAccountAuthError(
      "not_allowed",
      "Moo Account sign-in needs permission to share account identity data.",
    );
  }

  private async sessionOperationCanUseNetwork(generation: number): Promise<boolean> {
    if (generation !== this.sessionGeneration) return false;
    if (await this.hasDataConsent()) return true;
    await this.forgetSession();
    return false;
  }

  private async hasDataConsent(): Promise<boolean> {
    try {
      return this.dependencies.hasDataConsent ? await this.dependencies.hasDataConsent() : true;
    } catch {
      return false;
    }
  }

  private async revokeSession(session: PersistedMooAccountSession): Promise<void> {
    const config = requireConfig(this.config);
    const authorizationServer = await this.authorizationServer();
    if (!authorizationServer.revocation_endpoint) return;
    const tokens = [
      ...(session.refreshToken ? [{ token: session.refreshToken, tokenTypeHint: "refresh_token" }] : []),
      { token: session.accessToken, tokenTypeHint: "access_token" },
    ];
    await Promise.all(
      tokens.map(async ({ token, tokenTypeHint }) => {
        const response = await oauth.revocationRequest(
          authorizationServer,
          { client_id: config.clientId },
          oauth.None(),
          token,
          this.requestOptions({ token_type_hint: tokenTypeHint }),
        );
        await oauth.processRevocationResponse(response);
      }),
    );
  }

  private async authorizationServer(): Promise<oauth.AuthorizationServer> {
    const config = requireConfig(this.config);
    this.discoveryPromise ||= oauth
      .discoveryRequest(new URL(config.issuer), this.requestOptions<oauth.DiscoveryRequestOptions>())
      .then((response) => oauth.processDiscoveryResponse(new URL(config.issuer), response))
      .then((metadata) => validateAuthorizationServer(metadata, config))
      .catch((error) => {
        this.discoveryPromise = undefined;
        throw error;
      });
    return this.discoveryPromise;
  }

  private requestOptions<T extends object = oauth.TokenEndpointRequestOptions>(
    additionalParameters?: Record<string, string>,
  ): T {
    const allowInsecureRequests = this.config && isLoopbackHttpUrl(this.config.issuer);
    return {
      [oauth.customFetch]: this.oauthFetch,
      ...(allowInsecureRequests ? { [oauth.allowInsecureRequests]: true } : {}),
      ...(additionalParameters ? { additionalParameters } : {}),
    } as T;
  }
}

export class MooAccountAuthError extends Error {
  constructor(
    readonly code: MooAccountErrorCode,
    message: string,
    options?: unknown,
  ) {
    super(message, options === undefined ? undefined : { cause: options });
    this.name = "MooAccountAuthError";
  }
}

class SupersededAccountOperationError extends Error {}

export function compiledMooAccountAuthConfig(): MooAccountAuthConfig | null {
  if (typeof __MOOFLIGHTS_AUTH_ENABLED__ !== "boolean" || !__MOOFLIGHTS_AUTH_ENABLED__) return null;
  const config = {
    issuer: __MOOFLIGHTS_AUTH_ISSUER__,
    clientId: __MOOFLIGHTS_AUTH_CLIENT_ID__,
    audience: __MOOFLIGHTS_AUTH_AUDIENCE__,
  };
  return config.issuer && config.clientId && config.audience ? config : null;
}

export function publicAccountError(error: unknown): MooAccountError {
  if (error instanceof MooAccountAuthError) return { code: error.code, message: error.message };
  if (
    error instanceof oauth.ResponseBodyError ||
    error instanceof oauth.AuthorizationResponseError ||
    error instanceof oauth.OperationProcessingError
  ) {
    return {
      code: "authorization_failed",
      message: "Moo Account could not complete sign-in. Please try again.",
    };
  }
  if (error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError")) {
    return {
      code: "network_error",
      message: "Moo Account could not be reached. Check your connection and try again.",
    };
  }
  return {
    code: "unexpected_error",
    message: "Moo Account is temporarily unavailable. Try again.",
  };
}

function validateAuthorizationServer(
  authorizationServer: oauth.AuthorizationServer,
  config: MooAccountAuthConfig,
): oauth.AuthorizationServer {
  if (!authorizationServer.authorization_endpoint || !authorizationServer.token_endpoint) {
    throw new Error("Moo Account discovery is missing required endpoints.");
  }
  if (authorizationServer.code_challenge_methods_supported?.includes("S256") !== true) {
    throw new Error("Moo Account must advertise PKCE S256 support.");
  }
  if (authorizationServer.response_types_supported?.includes("code") !== true) {
    throw new Error("Moo Account does not advertise the authorization code flow.");
  }
  if (
    authorizationServer.grant_types_supported &&
    !authorizationServer.grant_types_supported.includes("authorization_code")
  ) {
    throw new Error("Moo Account does not advertise the authorization code grant.");
  }

  const issuerOrigin = new URL(config.issuer).origin;
  for (const endpoint of [
    authorizationServer.authorization_endpoint,
    authorizationServer.token_endpoint,
    authorizationServer.userinfo_endpoint,
    authorizationServer.revocation_endpoint,
    authorizationServer.jwks_uri,
  ]) {
    if (!endpoint) continue;
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && new URL(config.issuer).protocol === "https:") {
      throw new Error("Moo Account endpoints must use HTTPS.");
    }
    if (url.origin !== issuerOrigin) {
      throw new Error("Moo Account endpoints must use the configured issuer origin.");
    }
  }
  return authorizationServer;
}

function validatedCallbackUrl(value: string, redirectUri: string): URL {
  const callbackUrl = new URL(value);
  const expected = new URL(redirectUri);
  if (callbackUrl.origin !== expected.origin || callbackUrl.pathname !== expected.pathname) {
    throw new Error("Moo Account returned an unexpected redirect URL.");
  }
  return callbackUrl;
}

function sessionMatchesConfig(session: PersistedMooAccountSession, config: MooAccountAuthConfig): boolean {
  return (
    session.issuer === config.issuer && session.clientId === config.clientId && session.audience === config.audience
  );
}

function samePersistedSession(left: PersistedMooAccountSession, right: PersistedMooAccountSession): boolean {
  return (
    sessionMatchesConfig(left, right) &&
    left.subject === right.subject &&
    left.accessToken === right.accessToken &&
    left.refreshToken === right.refreshToken
  );
}

function publicSignedOutState(): MooAccountState {
  return { configured: true, status: "signed-out" };
}

function publicSignedInState(session: PersistedMooAccountSession): MooAccountState {
  return {
    configured: true,
    status: "signed-in",
    account: {
      displayName: session.displayName,
      ...(session.email ? { email: session.email } : {}),
      emailVerified: session.emailVerified,
    },
    authenticatedAt: session.authenticatedAt,
  };
}

function requireConfig(config: MooAccountAuthConfig | null): MooAccountAuthConfig {
  if (!config) throw new MooAccountAuthError("not_configured", "Moo Account is not configured in this build.");
  return config;
}

function stringClaim(value: oauth.JsonValue | undefined): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function accountProfile(claims: oauth.IDToken): MooAccountProfile {
  const email = stringClaim(claims.email);
  const displayName = stringClaim(claims.name) || stringClaim(claims.preferred_username) || email || "Moo Account";
  return {
    displayName,
    ...(email ? { email } : {}),
    emailVerified: claims.email_verified === true,
  };
}

function accessTokenExpiry(now: number, expiresIn: number | undefined): number {
  return now + (typeof expiresIn === "number" ? Math.max(0, expiresIn * 1000) : FALLBACK_ACCESS_TOKEN_LIFETIME_MS);
}

function isUserCancellation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /cancel|closed|denied|did not approve|user rejected/i.test(error.message);
}

function isLoopbackHttpUrl(value: string): boolean {
  const url = new URL(value);
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

function timeoutFetch(fetchImplementation: typeof fetch, timeoutMs: number): typeof fetch {
  return async (input, init = {}) => {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
    const callerSignal = init.signal;
    const abortFromCaller = () => timeoutController.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      return await fetchImplementation(input, { ...init, signal: timeoutController.signal });
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    }
  };
}
