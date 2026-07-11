import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export default async function globalSetup(): Promise<void> {
  await execFileAsync("bun", ["run", "build:dev"], {
    env: {
      ...process.env,
      MOOFLIGHTS_DIST_DIR: "dist",
      MOOFLIGHTS_AUTH_ISSUER: "https://id.michaelmwu.com",
      MOOFLIGHTS_AUTH_CLIENT_ID: "mooflights-extension-e2e",
      MOOFLIGHTS_AUTH_AUDIENCE: "https://api.mootravel.app",
    },
  });
}
