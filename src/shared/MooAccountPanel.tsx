import type React from "react";
import type { createTranslator } from "./i18n";
import { useMooAccount } from "./useMooAccount";
import "./mooAccount.css";

export function MooAccountPanel(props: {
  t: ReturnType<typeof createTranslator>;
  compact?: boolean;
}): React.ReactElement | null {
  if (!__MOOFLIGHTS_AUTH_ENABLED__) return null;
  return <ConfiguredMooAccountPanel {...props} />;
}

function ConfiguredMooAccountPanel(props: {
  t: ReturnType<typeof createTranslator>;
  compact?: boolean;
}): React.ReactElement {
  const { t } = props;
  const account = useMooAccount();
  const signingIn = account.pendingCommand === "mooAccount:signIn";
  const signingOut = account.pendingCommand === "mooAccount:signOut";

  return (
    <section className={`moo-account ${props.compact ? "compact" : ""}`}>
      <div className="moo-account-heading">
        <div>
          <h2>{t("mooAccount")}</h2>
          <p>{t("mooAccountTagline")}</p>
        </div>
        {account.state?.status === "signed-in" ? (
          <span className="moo-account-avatar" aria-hidden="true">
            {accountInitial(account.state.account.displayName)}
          </span>
        ) : null}
      </div>

      {account.state === null ? <p className="moo-account-status">{t("mooAccountLoading")}</p> : null}

      {account.state?.status === "unavailable" ? (
        <p className="moo-account-status">{t("mooAccountUnavailable")}</p>
      ) : null}

      {account.state?.status === "signed-out" ? (
        <div className="moo-account-body">
          <p>{t("mooAccountSignedOut")}</p>
          <button type="button" className="moo-account-primary" disabled={signingIn} onClick={() => account.signIn()}>
            {signingIn ? t("mooAccountSigningIn") : t("mooAccountSignIn")}
          </button>
        </div>
      ) : null}

      {account.state?.status === "signed-in" ? (
        <div className="moo-account-body">
          <div className="moo-account-profile">
            <strong>{account.state.account.displayName}</strong>
            {account.state.account.email ? <span>{account.state.account.email}</span> : null}
          </div>
          <button
            type="button"
            className="moo-account-secondary"
            disabled={signingOut}
            onClick={() => account.signOut()}
          >
            {signingOut ? t("mooAccountSigningOut") : t("mooAccountSignOut")}
          </button>
        </div>
      ) : null}

      {account.error ? (
        <p className="moo-account-error" role="alert">
          {account.error.message}
        </p>
      ) : null}

      <p className="moo-account-privacy">{t("mooAccountPrivacy")}</p>
    </section>
  );
}

function accountInitial(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "M";
}
