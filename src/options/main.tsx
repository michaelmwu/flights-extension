import "../shared/firefoxChromeCompat";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  airportAreaFromSearchValue,
  airportAreaOptions,
  airportAreaSearchValue,
  countryDisplayName,
} from "../shared/airports";
import { flagEmoji } from "../shared/flags";
import { DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES, parseGoogleFlightsCountryInput } from "../shared/googleFlightsBooking";
import {
  allGoogleFlightsCountryCodes,
  filterAvailableGoogleFlightsCountryCodes,
  googleFlightsAvailableCountryOptions,
  googleFlightsCountryCodeFromSearchValue,
  isAllGoogleFlightsCountryCodes,
} from "../shared/googleFlightsCountries";
import { createTranslator, htmlLang, LANGUAGE_OPTIONS } from "../shared/i18n";
import { MooAccountPanel } from "../shared/MooAccountPanel";
import {
  type MileageProgramOption,
  mileageProgramTierOptions,
  uniqueMileageProgramOptions,
} from "../shared/mileageEarnings";
import { ALWAYS_SHOWN_PROVIDER_IDS, LOCAL_PROVIDERS, providerConfidence } from "../shared/providers";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../shared/storage";
import type { AirportFilters, ExtensionSettings } from "../shared/types";
import "./options.css";

function Options(): React.ReactElement {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [programSearch, setProgramSearch] = useState("");
  const [googleFlightsCountrySearch, setGoogleFlightsCountrySearch] = useState("");
  const [saved, setSaved] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const t = useMemo(() => createTranslator(settings.language), [settings.language]);
  const airportAreas = useMemo(() => airportAreaOptions(settings.language), [settings.language]);
  const googleFlightsCountries = useMemo(
    () => googleFlightsAvailableCountryOptions(settings.language),
    [settings.language],
  );
  const allGoogleFlightsCountries = useMemo(() => allGoogleFlightsCountryCodes(), []);
  const usesAllGoogleFlightsCountries = isAllGoogleFlightsCountryCodes(settings.googleFlights.countryCodes);
  const mileagePrograms = useMemo(() => uniqueMileageProgramOptions(settings.language), [settings.language]);
  const visibleMileagePrograms = useMemo(
    () => filteredMileagePrograms(mileagePrograms, settings.preferredFrequentFlyerPrograms, programSearch),
    [mileagePrograms, settings.preferredFrequentFlyerPrograms, programSearch],
  );

  useEffect(() => {
    void loadSettings().then(
      (loadedSettings) => {
        setSettings(loadedSettings);
        setSettingsLoaded(true);
      },
      () => setSettingsLoaded(true),
    );
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(settings.language);
    document.title = t("optionsPageTitle");
  }, [settings.language, t]);

  async function persist(next: ExtensionSettings): Promise<void> {
    setSettings(next);
    await saveSettings(next);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  function setProviderPreference(providerId: string, preference: "preferred" | "hidden", enabled: boolean): void {
    const preferredProviderIds = new Set(settings.preferredProviderIds);
    const hiddenProviderIds = new Set(settings.hiddenProviderIds);
    if (preference === "preferred") {
      enabled ? preferredProviderIds.add(providerId) : preferredProviderIds.delete(providerId);
      if (enabled) hiddenProviderIds.delete(providerId);
    } else {
      enabled ? hiddenProviderIds.add(providerId) : hiddenProviderIds.delete(providerId);
      if (enabled) preferredProviderIds.delete(providerId);
    }
    void persist({
      ...settings,
      preferredProviderIds: Array.from(preferredProviderIds),
      hiddenProviderIds: Array.from(hiddenProviderIds),
    });
  }

  function togglePreferredProgram(program: string): void {
    const values = new Set(settings.preferredFrequentFlyerPrograms);
    values.has(program) ? values.delete(program) : values.add(program);
    const frequentFlyerProgramTiers = { ...settings.frequentFlyerProgramTiers };
    if (!values.has(program)) delete frequentFlyerProgramTiers[program];
    void persist({
      ...settings,
      preferredFrequentFlyerPrograms: Array.from(values),
      frequentFlyerProgramTiers,
    });
  }

  function setProgramTier(program: string, tier: string): void {
    const frequentFlyerProgramTiers = { ...settings.frequentFlyerProgramTiers };
    if (tier) {
      frequentFlyerProgramTiers[program] = tier;
    } else {
      delete frequentFlyerProgramTiers[program];
    }
    const preferredPrograms = new Set(settings.preferredFrequentFlyerPrograms);
    if (tier) preferredPrograms.add(program);
    void persist({
      ...settings,
      preferredFrequentFlyerPrograms: Array.from(preferredPrograms),
      frequentFlyerProgramTiers,
    });
  }

  function addGoogleFlightsCountry(): void {
    const country =
      googleFlightsCountryCodeFromSearchValue(googleFlightsCountrySearch, googleFlightsCountries) ||
      filterAvailableGoogleFlightsCountryCodes(parseGoogleFlightsCountryInput(googleFlightsCountrySearch))[0] ||
      "";
    if (!country) return;
    setGoogleFlightsCountrySearch("");
    void persist({
      ...settings,
      googleFlights: {
        ...settings.googleFlights,
        countryCodes: filterAvailableGoogleFlightsCountryCodes([...settings.googleFlights.countryCodes, country]),
      },
    });
  }

  function removeGoogleFlightsCountry(country: string): void {
    const countryCodes = filterAvailableGoogleFlightsCountryCodes(
      settings.googleFlights.countryCodes.filter((code) => code !== country),
    );
    void persist({
      ...settings,
      googleFlights: {
        ...settings.googleFlights,
        countryCodes,
      },
    });
  }

  const alwaysShownProviders = new Set<string>(ALWAYS_SHOWN_PROVIDER_IDS);
  const configurableProviders = LOCAL_PROVIDERS.filter((provider) => !alwaysShownProviders.has(provider.id));
  const preferredProviders = configurableProviders.filter((provider) =>
    settings.preferredProviderIds.includes(provider.id),
  );
  const hiddenProviders = configurableProviders.filter((provider) => settings.hiddenProviderIds.includes(provider.id));

  return (
    <main inert={!settingsLoaded} aria-busy={!settingsLoaded}>
      <header>
        <div className="title">
          <img src={chrome.runtime.getURL("assets/extension-icons/icon-48.png")} alt="" width="48" height="48" />
          <div>
            <h1>{t("appName")}</h1>
            <p>{t("appTagline")}</p>
          </div>
        </div>
        <span>{saved ? t("saved") : " "}</span>
      </header>

      <MooAccountPanel t={t} />

      <section>
        <h2>{t("general")}</h2>
        <p className="note">{t("languageNote")}</p>
        <label className="language-select">
          {t("language")}
          <select
            value={settings.language}
            onChange={(event) => {
              const language = LANGUAGE_OPTIONS.find((option) => option.code === event.currentTarget.value)?.code;
              if (!language) return;
              void persist({ ...settings, language });
            }}
          >
            {LANGUAGE_OPTIONS.map((language) => (
              <option key={language.code} value={language.code}>
                {language.nativeLabel} ({language.label})
              </option>
            ))}
          </select>
        </label>
      </section>

      <section>
        <h2>{t("googleFlights")}</h2>
        <p className="note">{t("googleFlightsNote")}</p>
        <div className="country-picker">
          <label>
            {t("addCountry")}
            <input
              type="search"
              list="google-country-options"
              value={googleFlightsCountrySearch}
              placeholder={t("countrySearchPlaceholder")}
              onChange={(event) => setGoogleFlightsCountrySearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addGoogleFlightsCountry();
              }}
            />
            <datalist id="google-country-options">
              {googleFlightsCountries.map((country) => (
                <option key={country.code} value={country.searchValue} />
              ))}
            </datalist>
          </label>
          <button type="button" className="secondary" onClick={addGoogleFlightsCountry}>
            {t("add")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void persist({
                ...settings,
                googleFlights: {
                  ...settings.googleFlights,
                  countryCodes: [...DEFAULT_GOOGLE_FLIGHTS_COUNTRY_CODES],
                },
              })
            }
          >
            {t("recommended")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void persist({
                ...settings,
                googleFlights: {
                  ...settings.googleFlights,
                  countryCodes: allGoogleFlightsCountries,
                },
              })
            }
          >
            {t("allUsefulCountries")}
          </button>
        </div>
        {usesAllGoogleFlightsCountries ? <p className="note country-warning">{t("allCountriesWarning")}</p> : null}
        <div className="country-list">
          {settings.googleFlights.countryCodes.map((country) => {
            const displayName = countryDisplayName(country, settings.language);
            return (
              <span className="country-chip" key={country}>
                <span className="flag" aria-hidden="true">
                  {flagEmoji(country)}
                </span>
                {displayName}
                <button
                  type="button"
                  aria-label={t("removeCountry", { country: displayName })}
                  onClick={() => removeGoogleFlightsCountry(country)}
                >
                  x
                </button>
              </span>
            );
          })}
        </div>
      </section>

      <section>
        <h2>{t("itaMatrix")}</h2>

        <div className="settings-group">
          <h3>{t("frequentFlyerPrograms")}</h3>
          <p className="note">{t("frequentFlyerProgramsNote")}</p>
          <label>
            {t("search")}
            <input
              type="search"
              value={programSearch}
              placeholder={t("programSearchPlaceholder")}
              onChange={(event) => setProgramSearch(event.currentTarget.value)}
            />
          </label>
          <fieldset className="program-list">
            <legend>{t("preferredFrequentFlyerPrograms")}</legend>
            <div className="program-list-scroll">
              {visibleMileagePrograms.map((program) => {
                const tierOptions = mileageProgramTierOptions(program.program, settings.language);
                return (
                  <div className={`program-row ${tierOptions.length > 0 ? "with-tier" : ""}`} key={program.program}>
                    <label className="program-choice">
                      <input
                        type="checkbox"
                        checked={settings.preferredFrequentFlyerPrograms.includes(program.program)}
                        onChange={() => togglePreferredProgram(program.program)}
                      />
                      <span className="program-icon" aria-hidden="true">
                        {program.carrierCodes[0] ? (
                          <img
                            src={chrome.runtime.getURL(`assets/carriers64/light/${program.carrierCodes[0]}.png`)}
                            alt=""
                            onError={(event) => {
                              event.currentTarget.style.visibility = "hidden";
                            }}
                          />
                        ) : null}
                      </span>
                      <span>{program.label}</span>
                    </label>
                    {tierOptions.length > 0 ? (
                      <select
                        aria-label={t("statusLevel", { program: program.program })}
                        value={settings.frequentFlyerProgramTiers[program.program] || ""}
                        onChange={(event) => setProgramTier(program.program, event.currentTarget.value)}
                      >
                        <option value="">{t("allLevels")}</option>
                        {tierOptions.map((tier) => (
                          <option key={tier.program} value={tier.program}>
                            {tier.label}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </fieldset>
          {visibleMileagePrograms.length === 0 ? (
            <p className="note">{t("noMatchingPrograms")}</p>
          ) : settings.preferredFrequentFlyerPrograms.length > 0 ? (
            <div className="selected-summary">
              {t("selectedCount", { count: settings.preferredFrequentFlyerPrograms.length })}
              <button
                type="button"
                onClick={() =>
                  void persist({ ...settings, preferredFrequentFlyerPrograms: [], frequentFlyerProgramTiers: {} })
                }
              >
                {t("clear")}
              </button>
            </div>
          ) : null}
        </div>

        <div className="settings-group">
          <h3>{t("airportHelperDefaults")}</h3>
          <div className="grid">
            <label>
              {t("area")}
              <input
                key={airportAreaSearchValue(settings.airportHelper, settings.language) || "any-area"}
                type="search"
                list="airport-area-options"
                defaultValue={airportAreaSearchValue(settings.airportHelper, settings.language)}
                placeholder={t("airportAreaPlaceholder")}
                onBlur={(event) => {
                  const nextAirportHelper = airportHelperWithArea(
                    settings.airportHelper,
                    event.currentTarget.value,
                    settings.language,
                  );
                  if (nextAirportHelper === settings.airportHelper) {
                    event.currentTarget.value = airportAreaSearchValue(settings.airportHelper, settings.language);
                    return;
                  }
                  void persist({
                    ...settings,
                    airportHelper: nextAirportHelper,
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.currentTarget.blur();
                }}
              />
              <datalist id="airport-area-options">
                {airportAreas.map((area) => (
                  <option key={`${area.type}:${area.value}`} value={area.searchValue} />
                ))}
              </datalist>
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void persist({
                  ...settings,
                  airportHelper: {
                    ...settings.airportHelper,
                    region: "",
                    continent: "",
                    countries: [],
                    exclusions: [],
                  },
                })
              }
            >
              {t("clearArea")}
            </button>
          </div>
        </div>

        <div className="settings-group">
          <h3>{t("providerLinks")}</h3>
          <p className="note">{t("providerLinksNote")}</p>
          <div className="provider-summary">
            <div>
              <strong>{t("preferred")}</strong>
              <div className="provider-chips">
                {preferredProviders.map((provider) => (
                  <button
                    type="button"
                    key={provider.id}
                    className="provider-chip"
                    onClick={() => setProviderPreference(provider.id, "preferred", false)}
                  >
                    {provider.label} x
                  </button>
                ))}
              </div>
            </div>
            <div>
              <strong>{t("hidden")}</strong>
              <div className="provider-chips">
                {hiddenProviders.length > 0
                  ? hiddenProviders.map((provider) => (
                      <button
                        type="button"
                        key={provider.id}
                        className="provider-chip muted"
                        onClick={() => setProviderPreference(provider.id, "hidden", false)}
                      >
                        {provider.label} x
                      </button>
                    ))
                  : t("none")}
              </div>
            </div>
          </div>
          <details className="provider-menu">
            <summary>{t("manageProviders")}</summary>
            <div className="provider-menu-list">
              {configurableProviders.map((provider) => {
                const reliability = providerReliabilityCopy(provider.reliabilityScore, t);
                return (
                  <div className={`provider-option ${reliability.tone}`} key={provider.id}>
                    <div>
                      <strong>{provider.label}</strong>
                      <small>
                        <span className="status-dot" aria-hidden="true" />
                        {reliability.label} · {categoryLabel(provider.category, t)}
                      </small>
                    </div>
                    <label className="check compact">
                      <input
                        type="checkbox"
                        checked={settings.preferredProviderIds.includes(provider.id)}
                        onChange={(event) =>
                          setProviderPreference(provider.id, "preferred", event.currentTarget.checked)
                        }
                      />
                      {t("prefer")}
                    </label>
                    <label className="check compact">
                      <input
                        type="checkbox"
                        checked={settings.hiddenProviderIds.includes(provider.id)}
                        onChange={(event) => setProviderPreference(provider.id, "hidden", event.currentTarget.checked)}
                      />
                      {t("hide")}
                    </label>
                  </div>
                );
              })}
            </div>
          </details>
        </div>
      </section>

      {__MOOFLIGHTS_DEV_BUILD__ ? (
        <DeveloperBackend settings={settings} setSettings={setSettings} persist={persist} />
      ) : null}

      <footer className="legal-footer">Copyright (c) 2026 Mu Travel LLC.</footer>
    </main>
  );
}

function DeveloperBackend(props: {
  settings: ExtensionSettings;
  setSettings: (settings: ExtensionSettings) => void;
  persist: (settings: ExtensionSettings) => Promise<void>;
}): React.ReactElement {
  const t = useMemo(() => createTranslator(props.settings.language), [props.settings.language]);
  const localTargets = [
    "http://localhost:48731",
    "http://127.0.0.1:48731",
    "http://localhost:3000",
    "http://localhost:8787",
  ];

  async function persistBackend(enabled: boolean, baseUrl = props.settings.backend.baseUrl): Promise<void> {
    const allowed = !enabled || (await requestBackendHostPermission(baseUrl));
    await props.persist({
      ...props.settings,
      backend: { enabled: allowed && enabled, baseUrl },
    });
  }

  return (
    <section className="dev-panel">
      <h2>{t("developerBackend")}</h2>
      <p className="note">{t("developerBackendNote")}</p>
      <label className="check">
        <input
          type="checkbox"
          checked={props.settings.backend.enabled}
          onChange={(event) => void persistBackend(event.currentTarget.checked)}
        />
        {t("fetchProviderMetadata")}
      </label>
      <label>
        {t("apiBaseUrl")}
        <input
          value={props.settings.backend.baseUrl}
          onChange={(event) =>
            props.setSettings({
              ...props.settings,
              backend: { ...props.settings.backend, baseUrl: event.currentTarget.value },
            })
          }
          onBlur={(event) => void persistBackend(props.settings.backend.enabled, event.currentTarget.value)}
        />
      </label>
      <div className="target-row">
        {localTargets.map((target) => (
          <button type="button" key={target} onClick={() => void persistBackend(true, target)}>
            {target}
          </button>
        ))}
      </div>
    </section>
  );
}

async function requestBackendHostPermission(baseUrl: string): Promise<boolean> {
  if (!chrome.permissions?.request) return false;
  const origin = hostPermissionOrigin(baseUrl);
  if (!origin) return false;
  return chrome.permissions.request({ origins: [origin] });
}

function hostPermissionOrigin(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}/*`;
  } catch {
    return "";
  }
}

function providerReliabilityCopy(
  score: number,
  t: ReturnType<typeof createTranslator>,
): { tone: "high" | "medium" | "low"; label: string } {
  const confidence = providerConfidence(score);
  if (confidence === "high") {
    return {
      tone: "high",
      label: t("reliable"),
    };
  }
  if (confidence === "medium") {
    return {
      tone: "medium",
      label: t("checkDetails"),
    };
  }
  return {
    tone: "low",
    label: t("unreliable"),
  };
}

function categoryLabel(category: string, t: ReturnType<typeof createTranslator>): string {
  if (category === "miles") return t("milesCredit");
  if (category === "meta") return t("flightSearch");
  if (category === "ota") return t("bookingSite");
  if (category === "airline") return t("airline");
  return category;
}

function airportHelperWithArea(
  airportHelper: AirportFilters,
  value: string,
  language: ExtensionSettings["language"],
): AirportFilters {
  if (!value.trim()) {
    return {
      ...airportHelper,
      region: "",
      continent: "",
      countries: [],
      exclusions: [],
    };
  }

  const area = airportAreaFromSearchValue(value, language);
  if (!hasAirportArea(area)) return airportHelper;

  const currentAreaValue = airportAreaSearchValue(airportHelper, language);
  const nextAreaValue = airportAreaSearchValue({ ...airportHelper, ...area }, language);
  const areaChanged = currentAreaValue !== nextAreaValue;

  return {
    ...airportHelper,
    ...area,
    exclusions: areaChanged ? [] : airportHelper.exclusions,
  };
}

function hasAirportArea(area: Pick<AirportFilters, "region" | "continent" | "countries">): boolean {
  return Boolean(area.region || area.continent || area.countries.length > 0);
}

function filteredMileagePrograms(
  programs: MileageProgramOption[],
  selectedPrograms: string[],
  search: string,
): MileageProgramOption[] {
  const selectedRanks = new Map(selectedPrograms.map((program, index) => [program, index]));
  const query = search.trim().toLowerCase();
  return programs
    .filter(
      (program) =>
        !query ||
        program.label.toLowerCase().includes(query) ||
        program.searchValue.toLowerCase().includes(query) ||
        program.aliases.some((alias) => alias.toLowerCase().includes(query)) ||
        program.carrierCodes.some((carrierCode) => carrierCode.toLowerCase().includes(query)),
    )
    .sort((left, right) => {
      const leftSelected = selectedRanks.has(left.program);
      const rightSelected = selectedRanks.has(right.program);
      if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
      if (leftSelected && rightSelected) {
        return (selectedRanks.get(left.program) ?? 0) - (selectedRanks.get(right.program) ?? 0);
      }
      return left.label.localeCompare(right.label);
    });
}

createRoot(document.getElementById("root") as HTMLElement).render(<Options />);
