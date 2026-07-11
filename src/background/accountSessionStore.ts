export type PersistedMooAccountSession = {
  version: 1;
  issuer: string;
  clientId: string;
  audience: string;
  subject: string;
  displayName: string;
  email?: string;
  emailVerified: boolean;
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  scope: string;
  accessTokenExpiresAt: number;
  authenticatedAt: string;
};

export interface MooAccountSessionStore {
  get(): Promise<PersistedMooAccountSession | null>;
  set(session: PersistedMooAccountSession): Promise<void>;
  clear(): Promise<void>;
}

const DATABASE_NAME = "mooflights-private-account-session";
const DATABASE_VERSION = 1;
const SESSION_STORE_NAME = "sessions";
const CURRENT_SESSION_KEY = "current";

/**
 * IndexedDB is scoped to the extension origin. Content scripts execute in the
 * visited page's origin, so they cannot read this database. Popup and options
 * code intentionally use typed background messages instead of opening it.
 */
export class IndexedDbMooAccountSessionStore implements MooAccountSessionStore {
  private databasePromise: Promise<IDBDatabase> | undefined;

  async get(): Promise<PersistedMooAccountSession | null> {
    const database = await this.database();
    const transaction = database.transaction(SESSION_STORE_NAME, "readonly");
    const completion = transactionComplete(transaction);
    const value = await requestResult<unknown>(transaction.objectStore(SESSION_STORE_NAME).get(CURRENT_SESSION_KEY));
    await completion;
    if (value === undefined) return null;
    if (isPersistedMooAccountSession(value)) return value;
    await this.clear();
    return null;
  }

  async set(session: PersistedMooAccountSession): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
    transaction.objectStore(SESSION_STORE_NAME).put(session, CURRENT_SESSION_KEY);
    await transactionComplete(transaction);
  }

  async clear(): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(SESSION_STORE_NAME, "readwrite");
    transaction.objectStore(SESSION_STORE_NAME).delete(CURRENT_SESSION_KEY);
    await transactionComplete(transaction);
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ||= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(SESSION_STORE_NAME)) {
          request.result.createObjectStore(SESSION_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open private account storage."));
      request.onblocked = () => reject(new Error("Private account storage upgrade was blocked."));
    }).catch((error: unknown) => {
      this.databasePromise = undefined;
      throw error;
    });
    return this.databasePromise;
  }
}

export function isPersistedMooAccountSession(value: unknown): value is PersistedMooAccountSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Partial<PersistedMooAccountSession>;
  return (
    session.version === 1 &&
    typeof session.issuer === "string" &&
    typeof session.clientId === "string" &&
    typeof session.audience === "string" &&
    typeof session.subject === "string" &&
    typeof session.displayName === "string" &&
    (session.email === undefined || typeof session.email === "string") &&
    typeof session.emailVerified === "boolean" &&
    typeof session.accessToken === "string" &&
    (session.refreshToken === undefined || typeof session.refreshToken === "string") &&
    typeof session.tokenType === "string" &&
    typeof session.scope === "string" &&
    typeof session.accessTokenExpiresAt === "number" &&
    Number.isFinite(session.accessTokenExpiresAt) &&
    typeof session.authenticatedAt === "string"
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Private account storage request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Private account storage transaction failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Private account storage transaction aborted."));
  });
}
