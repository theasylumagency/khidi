"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";

export function StorefrontCreateForm({ sellers }: { sellers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [key, setKey] = useState(() => createUuidV7());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget, values = new FormData(form);
    const input = { key: String(values.get("key")), name: String(values.get("name")), domain: String(values.get("domain")),
      sellerEntityId: String(values.get("sellerEntityId")), mediaBaseUrl: String(values.get("mediaBaseUrl")),
      ...(values.get("webhookUrl") ? { webhookUrl: String(values.get("webhookUrl")) } : {}) };
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/storefronts", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(input) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? t("scanning.error"));
      form.reset(); setKey(createUuidV7()); setMessage(t("storefront.created")); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : t("scanning.error")); }
    finally { setBusy(false); }
  }
  return <section className="pricing"><h2>{t("storefront.create")}</h2><form onSubmit={(event) => void submit(event)}><fieldset disabled={busy}>
    <label>{t("storefront.key")} <input name="key" required minLength={2} maxLength={64} pattern="[a-z0-9-]+" aria-describedby="storefront-key-help" /></label>
    <p id="storefront-key-help">{t("storefront.key_help")}</p>
    <label>{t("storefront.name")} <input name="name" required minLength={2} maxLength={120} /></label>
    <label>{t("storefront.domain")} <input name="domain" required maxLength={255} /></label>
    <label>{t("storefront.seller")} <select name="sellerEntityId" required>{sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</select></label>
    <label>{t("storefront.media_url")} <input name="mediaBaseUrl" type="url" required /></label>
    <label>{t("storefront.webhook_url")} <input name="webhookUrl" type="url" /></label>
    <button>{t("storefront.create")}</button>
  </fieldset></form><p role="status">{message}</p></section>;
}
