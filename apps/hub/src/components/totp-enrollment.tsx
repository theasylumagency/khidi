import { t } from "@khidi/i18n";

export interface TotpEnrollment {
  base32Secret: string;
  otpauthUri: string;
  accountLabel: string;
  qrSvg: string;
}

export async function copyTotpSetupKey(enrollment: TotpEnrollment, writeText: (text: string) => Promise<void>) {
  await writeText(enrollment.base32Secret);
}

export function TotpEnrollmentSetup({ enrollment, onCopy, copyNotice }: {
  enrollment: TotpEnrollment; onCopy(): void; copyNotice: string | null;
}) {
  const qr = <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(enrollment.qrSvg)}`}
    alt={t("auth.qr_label")} width={240} height={240} />;
  return <section className="totp-setup" aria-labelledby="totp-setup-title">
    <h3 id="totp-setup-title">{t("auth.enroll_add")}</h3>
    <p>{enrollment.accountLabel}</p>
    <p>{t("auth.enroll_help")}</p>
    <div className="totp-desktop-qr">{qr}</div>
    <a className="totp-open" href={enrollment.otpauthUri}>{t("auth.open_authenticator")}</a>
    <p className="auth-help">{t("auth.authenticator_fallback")}</p>
    <details className="totp-mobile-qr"><summary>{t("auth.show_qr_other_device")}</summary>{qr}</details>
    <button type="button" className="auth-secondary" onClick={onCopy}>{t("auth.copy_setup_key")}</button>
    <p role="status">{copyNotice ?? ""}</p>
    <details><summary>{t("auth.show_setup_key")}</summary><code className="totp-secret">{enrollment.base32Secret}</code></details>
  </section>;
}
