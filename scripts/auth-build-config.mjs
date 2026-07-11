const AUTH_ENVIRONMENT_VARIABLES = ["MOOFLIGHTS_AUTH_ISSUER", "MOOFLIGHTS_AUTH_CLIENT_ID", "MOOFLIGHTS_AUTH_AUDIENCE"];

export function resolveAuthBuildConfig(environment, { devBuild = false } = {}) {
  const [issuerValue, clientId, audienceValue] = AUTH_ENVIRONMENT_VARIABLES.map((name) => environment[name]?.trim());
  const values = [issuerValue, clientId, audienceValue];

  if (values.every((value) => !value)) {
    return {
      enabled: false,
      issuer: "",
      clientId: "",
      audience: "",
    };
  }

  const missing = AUTH_ENVIRONMENT_VARIABLES.filter((_, index) => !values[index]);
  if (missing.length > 0) {
    throw new Error(`Moo Account build configuration is incomplete. Missing: ${missing.join(", ")}`);
  }

  const issuer = validatedUrl(issuerValue, "MOOFLIGHTS_AUTH_ISSUER", { devBuild, allowPath: true });
  const audience = validatedUrl(audienceValue, "MOOFLIGHTS_AUTH_AUDIENCE", {
    devBuild,
    allowPath: true,
  });
  if (issuer.search || issuer.hash) {
    throw new Error("MOOFLIGHTS_AUTH_ISSUER must not include a query string or fragment.");
  }
  if (audience.search || audience.hash) {
    throw new Error("MOOFLIGHTS_AUTH_AUDIENCE must not include a query string or fragment.");
  }

  return {
    enabled: true,
    issuer: issuerValue,
    clientId,
    audience: audienceValue,
  };
}

export function authIssuerHostPermission(config) {
  if (!config.enabled) return null;
  const issuer = new URL(config.issuer);
  return `${issuer.protocol}//${issuer.hostname}/*`;
}

function validatedUrl(value, name, { devBuild, allowPath }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL.`);
  }

  const isLocalDevelopment =
    devBuild &&
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !isLocalDevelopment) {
    throw new Error(`${name} must use HTTPS${devBuild ? " or a loopback HTTP URL" : ""}.`);
  }
  if (!allowPath && url.pathname !== "/") throw new Error(`${name} must not include a path.`);
  return url;
}
