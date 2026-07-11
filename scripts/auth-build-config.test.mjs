import { authIssuerHostPermission, resolveAuthBuildConfig } from "./auth-build-config.mjs";

describe("Moo Account build configuration", () => {
  it("keeps account code disabled when no auth environment is supplied", () => {
    expect(resolveAuthBuildConfig({})).toEqual({
      enabled: false,
      issuer: "",
      clientId: "",
      audience: "",
    });
  });

  it("requires issuer, public client id, and resource audience together", () => {
    expect(() =>
      resolveAuthBuildConfig({
        MOOFLIGHTS_AUTH_ISSUER: "https://id.michaelmwu.com",
        MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension",
      }),
    ).toThrow("MOOFLIGHTS_AUTH_AUDIENCE");
  });

  it("preserves exact identifiers and derives only the issuer host permission", () => {
    const config = resolveAuthBuildConfig({
      MOOFLIGHTS_AUTH_ISSUER: "https://id.michaelmwu.com",
      MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension",
      MOOFLIGHTS_AUTH_AUDIENCE: "https://api.mootravel.app",
    });

    expect(config).toEqual({
      enabled: true,
      issuer: "https://id.michaelmwu.com",
      clientId: "mooflights-extension",
      audience: "https://api.mootravel.app",
    });
    expect(authIssuerHostPermission(config)).toBe("https://id.michaelmwu.com/*");
  });

  it("rejects insecure production origins but allows loopback HTTP in dev builds", () => {
    const insecure = {
      MOOFLIGHTS_AUTH_ISSUER: "http://id.example.test",
      MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension",
      MOOFLIGHTS_AUTH_AUDIENCE: "https://api.mootravel.app",
    };
    expect(() => resolveAuthBuildConfig(insecure)).toThrow("must use HTTPS");
    expect(() => resolveAuthBuildConfig(insecure, { devBuild: true })).toThrow("must use HTTPS");

    const localConfig = resolveAuthBuildConfig(
      {
        ...insecure,
        MOOFLIGHTS_AUTH_ISSUER: "http://127.0.0.1:4310",
        MOOFLIGHTS_AUTH_AUDIENCE: "http://localhost:48731",
      },
      { devBuild: true },
    );
    expect(localConfig).toMatchObject({ enabled: true, issuer: "http://127.0.0.1:4310" });
    expect(authIssuerHostPermission(localConfig)).toBe("http://127.0.0.1/*");
  });

  it("rejects issuer and audience query strings or fragments", () => {
    expect(() =>
      resolveAuthBuildConfig({
        MOOFLIGHTS_AUTH_ISSUER: "https://id.example.test?tenant=moo",
        MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension",
        MOOFLIGHTS_AUTH_AUDIENCE: "https://api.mootravel.app",
      }),
    ).toThrow("query string or fragment");
    expect(() =>
      resolveAuthBuildConfig({
        MOOFLIGHTS_AUTH_ISSUER: "https://id.example.test#fragment",
        MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension",
        MOOFLIGHTS_AUTH_AUDIENCE: "https://api.mootravel.app",
      }),
    ).toThrow("query string or fragment");
    expect(() =>
      resolveAuthBuildConfig({
        MOOFLIGHTS_AUTH_ISSUER: "https://id.example.test",
        MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension",
        MOOFLIGHTS_AUTH_AUDIENCE: "https://api.mootravel.app?resource=moo",
      }),
    ).toThrow("query string or fragment");
    expect(() =>
      resolveAuthBuildConfig({
        MOOFLIGHTS_AUTH_ISSUER: "https://id.example.test",
        MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension",
        MOOFLIGHTS_AUTH_AUDIENCE: "https://api.mootravel.app#fragment",
      }),
    ).toThrow("query string or fragment");
  });
});
