import { isPersistedMooAccountSession, type PersistedMooAccountSession } from "./accountSessionStore";

const SESSION: PersistedMooAccountSession = {
  version: 1,
  issuer: "https://id.example.test",
  clientId: "mooflights-extension",
  audience: "https://api.example.test",
  subject: "account-123",
  displayName: "Ada Lovelace",
  email: "ada@example.test",
  emailVerified: true,
  accessToken: "access-token",
  refreshToken: "refresh-token",
  tokenType: "bearer",
  scope: "openid profile email offline_access",
  accessTokenExpiresAt: Date.now() + 300_000,
  authenticatedAt: "2026-07-10T12:00:00.000Z",
};

describe("private Moo Account session storage", () => {
  it("accepts the versioned persisted session contract", () => {
    expect(isPersistedMooAccountSession(SESSION)).toBe(true);
  });

  it("rejects malformed and legacy token records", () => {
    expect(isPersistedMooAccountSession({ ...SESSION, version: 2 })).toBe(false);
    expect(isPersistedMooAccountSession({ ...SESSION, accessTokenExpiresAt: "soon" })).toBe(false);
    expect(isPersistedMooAccountSession({ accessToken: "legacy-token" })).toBe(false);
  });
});
