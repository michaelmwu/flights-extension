import "../shared/firefoxChromeCompat";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { createTranslator, htmlLang } from "../shared/i18n";
import { MooAccountPanel } from "../shared/MooAccountPanel";
import { LOCAL_PROVIDERS } from "../shared/providers";
import { DEFAULT_SETTINGS, loadSettings, mergeSettings, SETTINGS_KEY } from "../shared/storage";
import type { ExtensionSettings } from "../shared/types";
import "./popup.css";

const PROVIDER_LABELS = new Map(LOCAL_PROVIDERS.map((provider) => [provider.id, provider.label]));

function Popup(): React.ReactElement {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const t = useMemo(() => createTranslator(settings.language), [settings.language]);

  useEffect(() => {
    let active = true;
    void loadSettings().then((nextSettings) => {
      if (active) setSettings(nextSettings);
    });

    function handleStorageChange(changes: Record<string, chrome.storage.StorageChange>, areaName: string): void {
      const settingsChange = changes[SETTINGS_KEY];
      if (areaName !== "local" || !settingsChange) return;
      setSettings(mergeSettings(settingsChange.newValue));
    }

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(settings.language);
  }, [settings.language]);

  return (
    <main>
      <header>
        <h1>{t("appName")}</h1>
        <p>{t("popupTagline")}</p>
      </header>

      <MooAccountPanel t={t} compact />

      <section>
        <dl>
          <div>
            <dt>{t("backend")}</dt>
            <dd>{settings.backend.enabled ? t("enabled") : t("localOnly")}</dd>
          </div>
          <div>
            <dt>{t("preferredLinks")}</dt>
            <dd>{preferredProviderSummary(settings.preferredProviderIds, t)}</dd>
          </div>
        </dl>
      </section>

      <section className="actions">
        <button type="button" onClick={() => chrome.tabs.create({ url: "https://matrix.itasoftware.com/" })}>
          {t("openItaMatrix")}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => chrome.runtime.sendMessage({ command: "openOptionsPage" })}
        >
          {t("options")}
        </button>
      </section>
    </main>
  );
}

function preferredProviderSummary(providerIds: string[], t: ReturnType<typeof createTranslator>): string {
  const labels = providerIds.map((providerId) => PROVIDER_LABELS.get(providerId) || providerId);
  if (labels.length === 0) return t("defaultRanking");
  if (labels.length <= 2) return labels.join(", ");
  return t("preferredProviderSummaryMore", {
    providers: labels.slice(0, 2).join(", "),
    count: labels.length - 2,
  });
}

createRoot(document.getElementById("root") as HTMLElement).render(<Popup />);
