import {
  hasMooAccountDataConsent,
  isMooAccountRequest,
  isTrustedMooAccountSender,
  type MooAccountResponse,
  removesMooAccountDataConsent,
  requestMooAccountDataConsent,
} from "./accountMessages";

describe("Moo Account runtime messages", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("recognizes only the typed account commands", () => {
    expect(isMooAccountRequest({ command: "mooAccount:getState" })).toBe(true);
    expect(isMooAccountRequest({ command: "mooAccount:signIn" })).toBe(true);
    expect(isMooAccountRequest({ command: "mooAccount:signOut" })).toBe(true);
    expect(isMooAccountRequest({ command: "compareGoogleFlightsCountries" })).toBe(false);
    expect(isMooAccountRequest(null)).toBe(false);
  });

  it("allows extension pages but rejects content scripts and foreign senders", () => {
    const runtimeId = "abcdefghijklmnopabcdefghijklmnop";
    const origin = `chrome-extension://${runtimeId}`;

    expect(isTrustedMooAccountSender({ id: runtimeId, url: `${origin}/popup/index.html` }, runtimeId, origin)).toBe(
      true,
    );
    expect(isTrustedMooAccountSender({ url: `${origin}/options/index.html` }, runtimeId, origin)).toBe(true);
    expect(
      isTrustedMooAccountSender(
        { id: runtimeId, tab: {} as chrome.tabs.Tab, url: `${origin}/options/index.html` },
        runtimeId,
        origin,
      ),
    ).toBe(true);
    expect(
      isTrustedMooAccountSender(
        { id: runtimeId, tab: {} as chrome.tabs.Tab, url: "https://www.google.com/travel/flights" },
        runtimeId,
        origin,
      ),
    ).toBe(false);
    expect(
      isTrustedMooAccountSender({ id: "another-extension", url: `${origin}/options/index.html` }, runtimeId, origin),
    ).toBe(false);
  });

  it("keeps token material out of the public response contract", () => {
    const response: MooAccountResponse = {
      ok: true,
      state: {
        configured: true,
        status: "signed-in",
        account: {
          displayName: "Ada Lovelace",
          email: "ada@example.test",
          emailVerified: true,
        },
        authenticatedAt: "2026-07-10T12:00:00.000Z",
      },
    };

    expect(JSON.stringify(response)).not.toMatch(/access.?token|refresh.?token|id.?token/i);
  });

  it("requests Firefox account data consent before sign-in", async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal("chrome", {
      permissions: { request },
      runtime: { getURL: () => "moz-extension://extension-id/" },
    });

    await expect(requestMooAccountDataConsent()).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({
      data_collection: ["authenticationInfo", "personallyIdentifyingInfo"],
    });
  });

  it("checks both Firefox account data grants in the background", async () => {
    const getAll = vi.fn(async () => ({
      data_collection: ["authenticationInfo", "personallyIdentifyingInfo"],
    }));
    vi.stubGlobal("chrome", {
      permissions: { getAll },
      runtime: { getURL: () => "moz-extension://extension-id/" },
    });

    await expect(hasMooAccountDataConsent()).resolves.toBe(true);
    getAll.mockResolvedValueOnce({ data_collection: ["authenticationInfo"] });
    await expect(hasMooAccountDataConsent()).resolves.toBe(false);
  });

  it("recognizes removal of either Firefox account data grant", () => {
    expect(removesMooAccountDataConsent({ data_collection: ["authenticationInfo"] })).toBe(true);
    expect(removesMooAccountDataConsent({ data_collection: ["personallyIdentifyingInfo"] })).toBe(true);
    expect(removesMooAccountDataConsent({ data_collection: ["technicalAndInteraction"] })).toBe(false);
  });

  it("does not mistake Chrome's browser namespace for Firefox", async () => {
    const request = vi.fn(async () => {
      throw new Error("Unexpected property: data_collection");
    });
    vi.stubGlobal("browser", {});
    vi.stubGlobal("chrome", {
      permissions: { request },
      runtime: { getURL: () => "chrome-extension://extension-id/" },
    });

    await expect(requestMooAccountDataConsent()).resolves.toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
