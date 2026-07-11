export type MooAccountProfile = {
  displayName: string;
  email?: string;
  emailVerified: boolean;
};

export type MooAccountState =
  | {
      configured: false;
      status: "unavailable";
    }
  | {
      configured: true;
      status: "signed-out";
    }
  | {
      configured: true;
      status: "signed-in";
      account: MooAccountProfile;
      authenticatedAt: string;
    };

export type MooAccountErrorCode =
  | "not_allowed"
  | "not_configured"
  | "sign_in_cancelled"
  | "authorization_failed"
  | "network_error"
  | "storage_error"
  | "unexpected_error";

export type MooAccountError = {
  code: MooAccountErrorCode;
  message: string;
};

export type MooAccountRequest =
  | { command: "mooAccount:getState" }
  | { command: "mooAccount:signIn" }
  | { command: "mooAccount:signOut" };

export type MooAccountResponse =
  | { ok: true; state: MooAccountState }
  | { ok: false; state: MooAccountState; error: MooAccountError };

const ACCOUNT_COMMANDS = new Set<MooAccountRequest["command"]>([
  "mooAccount:getState",
  "mooAccount:signIn",
  "mooAccount:signOut",
]);
const FIREFOX_MOO_ACCOUNT_DATA_TYPES = ["authenticationInfo", "personallyIdentifyingInfo"];

export function isMooAccountRequest(value: unknown): value is MooAccountRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = (value as { command?: unknown }).command;
  return typeof command === "string" && ACCOUNT_COMMANDS.has(command as MooAccountRequest["command"]);
}

export function isTrustedMooAccountSender(
  sender: Pick<chrome.runtime.MessageSender, "id" | "tab" | "url">,
  runtimeId: string,
  extensionRoot: string,
): boolean {
  if ((sender.id && sender.id !== runtimeId) || !sender.url) return false;
  try {
    const senderUrl = new URL(sender.url);
    const expectedUrl = new URL(extensionRoot);
    return senderUrl.protocol === expectedUrl.protocol && senderUrl.host === expectedUrl.host;
  } catch {
    return false;
  }
}

export async function sendMooAccountRequest(request: MooAccountRequest): Promise<MooAccountResponse> {
  try {
    const response = (await chrome.runtime.sendMessage(request)) as MooAccountResponse | undefined;
    if (isMooAccountResponse(response)) return response;
  } catch {
    // The service worker can be unavailable briefly after extension updates.
  }

  return {
    ok: false,
    state: unavailableMooAccountState(),
    error: {
      code: "unexpected_error",
      message: "Moo Account is temporarily unavailable. Try again.",
    },
  };
}

export async function requestMooAccountDataConsent(): Promise<boolean> {
  if (!isFirefoxExtension()) return true;
  const permissions = chrome.permissions as unknown as {
    request?: (request: { data_collection: string[] }) => Promise<boolean>;
  };
  if (typeof permissions.request !== "function") return false;
  try {
    return await permissions.request({ data_collection: FIREFOX_MOO_ACCOUNT_DATA_TYPES });
  } catch {
    return false;
  }
}

export async function hasMooAccountDataConsent(): Promise<boolean> {
  if (!isFirefoxExtension()) return true;
  const permissions = chrome.permissions as unknown as {
    getAll?: () => Promise<{ data_collection?: string[] }>;
  };
  if (typeof permissions.getAll !== "function") return false;
  try {
    const granted = await permissions.getAll();
    return FIREFOX_MOO_ACCOUNT_DATA_TYPES.every((dataType) => granted.data_collection?.includes(dataType));
  } catch {
    return false;
  }
}

export function removesMooAccountDataConsent(permissions: unknown): boolean {
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)) return false;
  const dataCollection = (permissions as { data_collection?: unknown }).data_collection;
  return (
    Array.isArray(dataCollection) &&
    FIREFOX_MOO_ACCOUNT_DATA_TYPES.some((dataType) => dataCollection.includes(dataType))
  );
}

export function unavailableMooAccountState(): MooAccountState {
  return { configured: false, status: "unavailable" };
}

function isMooAccountResponse(value: unknown): value is MooAccountResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { ok?: unknown; state?: unknown; error?: unknown };
  if (typeof candidate.ok !== "boolean" || !isMooAccountState(candidate.state)) return false;
  return candidate.ok || isMooAccountError(candidate.error);
}

function isMooAccountState(value: unknown): value is MooAccountState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { configured?: unknown; status?: unknown; account?: unknown; authenticatedAt?: unknown };
  if (candidate.configured === false) return candidate.status === "unavailable";
  if (candidate.configured !== true) return false;
  if (candidate.status === "signed-out") return true;
  if (candidate.status !== "signed-in" || typeof candidate.authenticatedAt !== "string") return false;
  return isMooAccountProfile(candidate.account);
}

function isMooAccountProfile(value: unknown): value is MooAccountProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { displayName?: unknown; email?: unknown; emailVerified?: unknown };
  return (
    typeof candidate.displayName === "string" &&
    (candidate.email === undefined || typeof candidate.email === "string") &&
    typeof candidate.emailVerified === "boolean"
  );
}

function isMooAccountError(value: unknown): value is MooAccountError {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as { code?: unknown; message?: unknown };
  return typeof candidate.code === "string" && typeof candidate.message === "string";
}

function isFirefoxExtension(): boolean {
  return chrome.runtime.getURL("").startsWith("moz-extension://");
}
