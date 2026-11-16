import type { ReactNode } from "react";
import { t } from "@khidi/i18n";
import { BridgeScene } from "./bridge-scene.tsx";
import { HubIcon } from "./hub-icon.tsx";

export function SignInStage({ children }: { children: ReactNode }) {
  return <div className="hub-login-stage">
    <div className="hub-login-brand">
      <div className="hub-login-heading"><p className="hub-hero-label"><span />{t("ui.login_eyebrow")}</p>
        <h2>{t("ui.login_title_first")}<br /><em>{t("ui.login_title_last")}</em></h2>
        <p>{t("ui.login_description")}</p>
      </div>
      <BridgeScene />
      <div className="hub-login-caption"><span>{t("ui.brand")}</span><small>{t("ui.login_note")}</small></div>
    </div>
    <div className="hub-login-body"><div className="hub-login-form-content">{children}</div>
      <p className="hub-login-security"><HubIcon name="security" />{t("scanner.protected")}</p>
    </div>
  </div>;
}
