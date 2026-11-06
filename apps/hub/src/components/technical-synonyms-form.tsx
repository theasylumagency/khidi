"use client";

import { useState, type FormEvent } from "react";
import { t } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";

export function TechnicalSynonymsForm({ terms }: {
  terms: { group: string; unit: string; aliases: string[] }[];
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const synonyms = Object.fromEntries(terms.map(({ group }) =>
      [group, String(data.get(group) ?? "").split("\n").map((term) => term.trim()).filter(Boolean)]));
    setSaving(true);
    setStatus("");
    try {
      const response = await fetch("/api/products/content", { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": createUuidV7()
      }, body: JSON.stringify({ action: "save-synonyms", synonyms }) });
      setStatus(t(response.ok ? "evidence.saved" : "content.synonyms_error"));
    } catch {
      setStatus(t("content.error"));
    } finally {
      setSaving(false);
    }
  }

  return <section className="office-login">
    <h2>{t("content.synonyms_title")}</h2>
    <p>{t("content.synonyms_help")}</p>
    <form onSubmit={save}>
      <fieldset disabled={saving}>
        {terms.map(({ group, unit, aliases }) => <label key={group}>
          {unit || t("content.synonyms_gears")}
          <textarea name={group} rows={2} defaultValue={aliases.join("\n")} />
        </label>)}
        <button type="submit">{t("evidence.save")}</button>
      </fieldset>
    </form>
    <p role="status">{status}</p>
  </section>;
}
