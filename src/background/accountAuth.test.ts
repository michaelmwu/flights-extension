// @vitest-environment node

import { type MooAccountAuthConfig, MooAccountAuthController } from "./accountAuth";
import type { MooAccountSessionStore, PersistedMooAccountSession } from "./accountSessionStore";

const NOW = Date.parse("2026-07-10T12:00:00.000Z");
const ISSUER = "https://id.example.test";
const CLIENT_ID = "mooflights-extension";
const AUDIENCE = "https://api.mootravel.app";
const REDIRECT_URI = "https://abcdefghijklmnopabcdefghijklmnop.chromiumapp.org/moo-account";
const SIGNING_KEY_ID = "test-signing-key";
const signingKeyPair = crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  },
  true,
  ["sign", "verify"],
);

const CONFIG: MooAccountAuthConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  audience: AUDIENCE,
};

class MemorySessionStore implements MooAccountSessionStore {
  session: PersistedMooAccountSession | null = null;

  async get(): Promise<PersistedMooAccountSession | null> {
    return this.session;
  }

  async set(session: PersistedMooAccountSession): Promise<void> {
    this.session = session;
  }

  async clear(): Promise<void> {
    this.session = null;
  }
}

class FailingSetSessionStore extends MemorySessionStore {
  override async set(): Promise<void> {
    throw new Error("storage unavailable");
  }
}

describe("Moo Account OIDC client", () => {
  it("uses a public authorization-code flow with PKCE, state, nonce, and RFC 8707 resource", async () => {
    const store = new MemorySessionStore();
    const requests: Request[] = [];
    let authorizationUrl: URL | undefined;
    const fetchImplementation = oidcFetch(requests, () => authorizationUrl?.searchParams.get("nonce") || "");
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: async ({ url }) => {
        authorizationUrl = new URL(url);
        return `${REDIRECT_URI}?code=single-use-code&state=${authorizationUrl.searchParams.get("state")}`;
      },
      fetch: fetchImplementation,
      now: () => NOW,
    });

    const state = await controller.signIn();

    expect(authorizationUrl?.origin).toBe(ISSUER);
    expect(authorizationUrl?.pathname).toBe("/oauth2/authorize");
    expect(authorizationUrl?.searchParams.get("response_type")).toBe("code");
    expect(authorizationUrl?.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl?.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorizationUrl?.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authorizationUrl?.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authorizationUrl?.searchParams.get("resource")).toBe(AUDIENCE);
    expect(authorizationUrl?.searchParams.get("prompt")).toBe("consent");
    expect(authorizationUrl?.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "profile",
      "email",
      "offline_access",
    ]);

    const tokenRequest = requests.find((request) => request.url === `${ISSUER}/oauth2/token`);
    expect(tokenRequest).toBeDefined();
    const tokenBody = new URLSearchParams(await tokenRequest?.clone().text());
    expect(tokenBody.get("grant_type")).toBe("authorization_code");
    expect(tokenBody.get("client_id")).toBe(CLIENT_ID);
    expect(tokenBody.get("client_secret")).toBeNull();
    expect(tokenBody.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenBody.get("resource")).toBe(AUDIENCE);

    expect(state).toEqual({
      configured: true,
      status: "signed-in",
      account: {
        displayName: "ID Token Name",
        email: "ada@example.test",
        emailVerified: true,
      },
      authenticatedAt: "2026-07-10T12:00:00.000Z",
    });
    expect(store.session).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      subject: "account-123",
      audience: AUDIENCE,
    });
    expect(JSON.stringify(state)).not.toContain("access-token");
    expect(JSON.stringify(state)).not.toContain("refresh-token");
    expect(requests.some((request) => request.url === `${ISSUER}/oauth2/userinfo`)).toBe(false);
  });

  it("rejects a callback whose state does not match", async () => {
    const store = new MemorySessionStore();
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: async () => `${REDIRECT_URI}?code=code&state=attacker-state`,
      fetch: oidcFetch([], () => "unused"),
      now: () => NOW,
    });

    await expect(controller.signIn()).rejects.toThrow();
    expect(store.session).toBeNull();
  });

  it("rejects an ID Token that is not signed by the issuer JWKS", async () => {
    const store = new MemorySessionStore();
    let authorizationUrl: URL | undefined;
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: async ({ url }) => {
        authorizationUrl = new URL(url);
        return `${REDIRECT_URI}?code=code&state=${authorizationUrl.searchParams.get("state")}`;
      },
      fetch: oidcFetch([], () => authorizationUrl?.searchParams.get("nonce") || "", {}, { tamperIdToken: true }),
      now: () => NOW,
    });

    await expect(controller.signIn()).rejects.toThrow();
    expect(store.session).toBeNull();
  });

  it("requires the issuer to advertise PKCE S256", async () => {
    const store = new MemorySessionStore();
    const launchWebAuthFlow = vi.fn();
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow,
      fetch: oidcFetch([], () => "unused", { code_challenge_methods_supported: ["plain"] }),
      now: () => NOW,
    });

    await expect(controller.signIn()).rejects.toThrow("PKCE S256");
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("rejects discovery endpoints outside the configured issuer origin", async () => {
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: new MemorySessionStore(),
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: oidcFetch([], () => "unused", { token_endpoint: "https://tokens.example.test/oauth2/token" }),
      now: () => NOW,
    });

    await expect(controller.signIn()).rejects.toThrow("configured issuer origin");
  });

  it("allows standards requests to an explicitly configured HTTP loopback issuer", async () => {
    const issuer = "http://127.0.0.1:4310";
    const config = { ...CONFIG, issuer };
    const store = new MemorySessionStore();
    const requests: Request[] = [];
    let authorizationUrl: URL | undefined;
    const controller = new MooAccountAuthController(config, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: async ({ url }) => {
        authorizationUrl = new URL(url);
        return `${REDIRECT_URI}?code=code&state=${authorizationUrl.searchParams.get("state")}`;
      },
      fetch: oidcFetch(requests, () => authorizationUrl?.searchParams.get("nonce") || "", {}, { issuer }),
      now: () => NOW,
    });

    await expect(controller.signIn()).resolves.toMatchObject({ status: "signed-in" });
    expect(requests[0]?.url).toBe(`${issuer}/.well-known/openid-configuration`);
  });

  it("rotates an expired session with a public refresh-token request", async () => {
    const store = new MemorySessionStore();
    store.session = persistedSession({ accessTokenExpiresAt: NOW - 1 });
    const requests: Request[] = [];
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: oidcFetch(requests, () => "unused"),
      now: () => NOW,
    });

    const state = await controller.getState();

    expect(state.status).toBe("signed-in");
    expect(store.session).toMatchObject({
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    });
    const refreshRequest = requests.find((request) => request.url === `${ISSUER}/oauth2/token`);
    expect(refreshRequest).toBeDefined();
    const refreshBody = new URLSearchParams(await refreshRequest?.clone().text());
    expect(refreshBody.get("client_id")).toBe(CLIENT_ID);
    expect(refreshBody.get("client_secret")).toBeNull();
    expect(refreshBody.get("refresh_token")).toBe("refresh-token");
    expect(refreshBody.get("resource")).toBe(AUDIENCE);
  });

  it("shares one rotating refresh across concurrent state reads", async () => {
    const store = new MemorySessionStore();
    store.session = persistedSession({ accessTokenExpiresAt: NOW - 1 });
    const requests: Request[] = [];
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: oidcFetch(requests, () => "unused"),
      now: () => NOW,
    });

    const states = await Promise.all([controller.getState(), controller.getState()]);

    expect(states.map((state) => state.status)).toEqual(["signed-in", "signed-in"]);
    expect(requests.filter((request) => request.url === `${ISSUER}/oauth2/token`)).toHaveLength(1);
    expect(store.session).toMatchObject({
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    });
  });

  it("does not let an in-flight refresh restore credentials after sign-out", async () => {
    const store = new MemorySessionStore();
    store.session = persistedSession({ accessTokenExpiresAt: NOW - 1 });
    const refreshStarted = deferred<void>();
    const releaseRefresh = deferred<void>();
    const requests: Request[] = [];
    const baseFetch = oidcFetch(requests, () => "unused");
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (request.url === `${ISSUER}/oauth2/token`) {
        const body = new URLSearchParams(await request.clone().text());
        if (body.get("grant_type") === "refresh_token") {
          refreshStarted.resolve(undefined);
          await releaseRefresh.promise;
        }
      }
      return baseFetch(input, init);
    }) as typeof fetch;
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: fetchImplementation,
      now: () => NOW,
    });

    const statePromise = controller.getState();
    await refreshStarted.promise;
    await controller.signOut();
    releaseRefresh.resolve(undefined);

    await expect(statePromise).resolves.toEqual({ configured: true, status: "signed-out" });
    expect(store.session).toBeNull();
    const revokedTokens = await Promise.all(
      requests
        .filter((request) => request.url === `${ISSUER}/oauth2/revoke`)
        .map(async (request) => new URLSearchParams(await request.clone().text()).get("token")),
    );
    expect(revokedTokens).toContain("rotated-refresh-token");
  });

  it("clears local credentials and best-effort revokes the refresh token on sign-out", async () => {
    const store = new MemorySessionStore();
    store.session = persistedSession();
    const requests: Request[] = [];
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: oidcFetch(requests, () => "unused"),
      now: () => NOW,
    });

    await expect(controller.signOut()).resolves.toEqual({ configured: true, status: "signed-out" });
    expect(store.session).toBeNull();
    const revokeBodies = await Promise.all(
      requests
        .filter((request) => request.url === `${ISSUER}/oauth2/revoke`)
        .map(async (request) => new URLSearchParams(await request.clone().text())),
    );
    expect(revokeBodies.map((body) => [body.get("token"), body.get("token_type_hint")])).toEqual([
      ["refresh-token", "refresh_token"],
      ["access-token", "access_token"],
    ]);
    expect(revokeBodies.every((body) => body.get("client_secret") === null)).toBe(true);
  });

  it("does not let an in-flight sign-in restore credentials after sign-out", async () => {
    const store = new MemorySessionStore();
    const callbackReady = deferred<void>();
    const callback = deferred<string | undefined>();
    let authorizationUrl: URL | undefined;
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: async ({ url }) => {
        authorizationUrl = new URL(url);
        callbackReady.resolve(undefined);
        return callback.promise;
      },
      fetch: oidcFetch([], () => authorizationUrl?.searchParams.get("nonce") || ""),
      now: () => NOW,
    });

    const signInPromise = controller.signIn();
    const signInExpectation = expect(signInPromise).rejects.toMatchObject({ code: "sign_in_cancelled" });
    await callbackReady.promise;
    await controller.signOut();
    callback.resolve(`${REDIRECT_URI}?code=code&state=${authorizationUrl?.searchParams.get("state")}`);

    await signInExpectation;
    expect(store.session).toBeNull();
  });

  it("does not exchange a code after Firefox consent is withdrawn from an open auth window", async () => {
    const store = new MemorySessionStore();
    const callbackReady = deferred<void>();
    const callback = deferred<string | undefined>();
    const requests: Request[] = [];
    let consentGranted = true;
    let authorizationUrl: URL | undefined;
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: async ({ url }) => {
        authorizationUrl = new URL(url);
        callbackReady.resolve(undefined);
        return callback.promise;
      },
      fetch: oidcFetch(requests, () => authorizationUrl?.searchParams.get("nonce") || ""),
      hasDataConsent: async () => consentGranted,
      now: () => NOW,
    });

    const signInPromise = controller.signIn();
    const signInExpectation = expect(signInPromise).rejects.toMatchObject({ code: "sign_in_cancelled" });
    await callbackReady.promise;
    consentGranted = false;
    await controller.forgetSession();
    callback.resolve(`${REDIRECT_URI}?code=code&state=${authorizationUrl?.searchParams.get("state")}`);

    await signInExpectation;
    expect(store.session).toBeNull();
    expect(requests.some((request) => request.url === `${ISSUER}/oauth2/token`)).toBe(false);
    expect(requests.some((request) => request.url === `${ISSUER}/.well-known/jwks.json`)).toBe(false);
    expect(requests.some((request) => request.url === `${ISSUER}/oauth2/userinfo`)).toBe(false);
  });

  it("revokes newly issued credentials when secure storage fails after sign-in", async () => {
    const store = new FailingSetSessionStore();
    const requests: Request[] = [];
    let authorizationUrl: URL | undefined;
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: async ({ url }) => {
        authorizationUrl = new URL(url);
        return `${REDIRECT_URI}?code=code&state=${authorizationUrl.searchParams.get("state")}`;
      },
      fetch: oidcFetch(requests, () => authorizationUrl?.searchParams.get("nonce") || ""),
      now: () => NOW,
    });

    await expect(controller.signIn()).rejects.toMatchObject({ code: "storage_error" });
    expect(store.session).toBeNull();
    const revokeRequest = requests.find((request) => request.url === `${ISSUER}/oauth2/revoke`);
    expect(new URLSearchParams(await revokeRequest?.clone().text()).get("token")).toBe("refresh-token");
  });

  it("revokes rotated credentials and clears the old session when refresh storage fails", async () => {
    const store = new FailingSetSessionStore();
    store.session = persistedSession({ accessTokenExpiresAt: NOW - 1 });
    const requests: Request[] = [];
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: oidcFetch(requests, () => "unused"),
      now: () => NOW,
    });

    await expect(controller.getState()).resolves.toEqual({ configured: true, status: "signed-out" });
    expect(store.session).toBeNull();
    const revokeRequest = requests.find((request) => request.url === `${ISSUER}/oauth2/revoke`);
    expect(new URLSearchParams(await revokeRequest?.clone().text()).get("token")).toBe("rotated-refresh-token");
  });

  it("keeps an unconfigured build signed out without launching a browser flow", async () => {
    const store = new MemorySessionStore();
    store.session = persistedSession();
    const launchWebAuthFlow = vi.fn();
    const controller = new MooAccountAuthController(null, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow,
      fetch,
      now: () => NOW,
    });

    await expect(controller.getState()).resolves.toEqual({ configured: false, status: "unavailable" });
    await expect(controller.signIn()).rejects.toThrow("not configured");
    expect(store.session).toBeNull();
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("removes credentials during startup when a release disables account configuration", async () => {
    const store = new MemorySessionStore();
    store.session = persistedSession();
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const controller = new MooAccountAuthController(null, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: fetchImplementation,
      now: () => NOW,
    });

    await controller.initialize();

    expect(store.session).toBeNull();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("clears a Firefox session without network access after data consent is withdrawn", async () => {
    const store = new MemorySessionStore();
    store.session = persistedSession({ accessTokenExpiresAt: NOW - 1 });
    const fetchImplementation = vi.fn() as unknown as typeof fetch;
    const controller = new MooAccountAuthController(CONFIG, {
      sessionStore: store,
      getRedirectUrl: () => REDIRECT_URI,
      launchWebAuthFlow: vi.fn(),
      fetch: fetchImplementation,
      hasDataConsent: async () => false,
      now: () => NOW,
    });

    await expect(controller.getState()).resolves.toEqual({ configured: true, status: "signed-out" });
    expect(store.session).toBeNull();
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

function oidcFetch(
  requests: Request[],
  nonce: () => string,
  metadataOverrides: Record<string, unknown> = {},
  options: { tamperIdToken?: boolean; issuer?: string } = {},
): typeof fetch {
  const issuer = options.issuer || ISSUER;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());

    if (request.url === `${issuer}/.well-known/openid-configuration`) {
      return jsonResponse({
        issuer,
        authorization_endpoint: `${issuer}/oauth2/authorize`,
        token_endpoint: `${issuer}/oauth2/token`,
        userinfo_endpoint: `${issuer}/oauth2/userinfo`,
        revocation_endpoint: `${issuer}/oauth2/revoke`,
        jwks_uri: `${issuer}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        ...metadataOverrides,
      });
    }

    if (request.url === `${issuer}/oauth2/token`) {
      const body = new URLSearchParams(await request.clone().text());
      if (body.get("grant_type") === "refresh_token") {
        return jsonResponse({
          access_token: "rotated-access-token",
          refresh_token: "rotated-refresh-token",
          token_type: "Bearer",
          expires_in: 300,
          scope: "openid profile email offline_access",
        });
      }
      const idToken = await signedJwt({
        iss: issuer,
        aud: CLIENT_ID,
        sub: "account-123",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: nonce(),
        name: "ID Token Name",
        email: "ada@example.test",
        email_verified: true,
      });
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token",
        token_type: "Bearer",
        expires_in: 300,
        scope: "openid profile email offline_access",
        id_token: options.tamperIdToken ? tamperJwtSignature(idToken) : idToken,
      });
    }

    if (request.url === `${issuer}/oauth2/userinfo`) {
      return jsonResponse({
        sub: "account-123",
        name: "Ada Lovelace",
        email: "ada@example.test",
        email_verified: true,
      });
    }

    if (request.url === `${issuer}/.well-known/jwks.json`) {
      const keyPair = await signingKeyPair;
      const publicKey = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
      return jsonResponse({
        keys: [{ ...publicKey, alg: "RS256", kid: SIGNING_KEY_ID, use: "sig" }],
      });
    }

    if (request.url === `${issuer}/oauth2/revoke`) return new Response(null, { status: 200 });
    throw new Error(`Unexpected OIDC request: ${request.method} ${request.url}`);
  }) as typeof fetch;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function signedJwt(payload: Record<string, unknown>): Promise<string> {
  const encodedHeader = base64Url({ alg: "RS256", kid: SIGNING_KEY_ID, typ: "JWT" });
  const encodedPayload = base64Url(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const keyPair = await signingKeyPair;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function base64Url(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return base64UrlBytes(bytes);
}

function base64UrlBytes(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function tamperJwtSignature(value: string): string {
  const [header, payload, encodedSignature] = value.split(".");
  const base64Signature = encodedSignature.replace(/-/g, "+").replace(/_/g, "/");
  const paddedSignature = base64Signature.padEnd(Math.ceil(base64Signature.length / 4) * 4, "=");
  const signature = Uint8Array.from(atob(paddedSignature), (character) => character.charCodeAt(0));
  signature[0] ^= 1;
  return `${header}.${payload}.${base64UrlBytes(signature)}`;
}

function persistedSession(overrides: Partial<PersistedMooAccountSession> = {}): PersistedMooAccountSession {
  return {
    version: 1,
    issuer: ISSUER,
    clientId: CLIENT_ID,
    audience: AUDIENCE,
    subject: "account-123",
    displayName: "Ada Lovelace",
    email: "ada@example.test",
    emailVerified: true,
    accessToken: "access-token",
    refreshToken: "refresh-token",
    tokenType: "bearer",
    scope: "openid profile email offline_access",
    accessTokenExpiresAt: NOW + 300_000,
    authenticatedAt: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
