import { expect, test } from "./fixtures";

test("loads the Manifest V3 service worker", async ({ extensionId, extensionServiceWorker }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);

  const manifest = await extensionServiceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.name).toBe("MooFlights");
  expect(manifest.permissions).toContain("identity");
  expect(manifest.host_permissions).toContain("https://id.michaelmwu.com/*");
  expect(manifest.host_permissions).not.toContain("https://api.mootravel.app/*");
});

test("renders the popup against extension storage defaults", async ({ openExtensionPage }) => {
  const page = await openExtensionPage("popup/index.html");

  await expect(page.getByRole("heading", { name: "MooFlights" })).toBeVisible();
  await expect(page.getByText("Offline-first ITA Matrix tools.")).toBeVisible();
  await expect(page.getByText("Local only")).toBeVisible();
  await expect(page.getByText("Kayak")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Moo Account" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/does not share flight searches or itineraries/)).toBeVisible();
});

test("persists Google Flights country settings from the options page", async ({ openExtensionPage }) => {
  const page = await openExtensionPage("options/index.html");

  await expect(page.getByRole("heading", { name: "MooFlights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Google Flights" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Moo Account" })).toBeVisible();

  await page.getByLabel("Add country").fill("FR");
  await page.getByRole("button", { name: "Add" }).click();

  await expect(page.getByText("Saved")).toBeVisible();
  await expect(page.getByText("France")).toBeVisible();

  await page.reload();

  await expect(page.getByText("France")).toBeVisible();
  await page.getByRole("button", { name: "Remove FR" }).click();
  await expect(page.getByText("France")).toBeHidden();
});
