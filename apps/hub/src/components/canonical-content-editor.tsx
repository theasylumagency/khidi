"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { t, type TranslationKey } from "@khidi/i18n";
import { createUuidV7 } from "@khidi/shared/uuid";
import type { ContentIssue, getCanonicalContentReview } from "@khidi/products";

type Review = Awaited<ReturnType<typeof getCanonicalContentReview>>;

export function CanonicalContentEditor({ skuId, review, archived }: { skuId: string; review: Review; archived: boolean }) {
  const router = useRouter();
  const locales = [...new Set(["ka", "en", ...review.versions.map((version) => version.locale)])];
  const [locale, setLocale] = useState("ka");
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [issues, setIssues] = useState<ContentIssue[] | null>(null);
  const versions = review.versions.filter((version) => version.locale === locale);
  const selected = versions.find((version) => version.id === selectedId) ?? versions[0];
  const approved = review.approved.find((item) => item.locale === locale);

  async function send(action: string, draft?: Record<string, unknown>) {
    if (saving) return;
    setSaving(true); setMessage(""); setIssues(null);
    try {
      const response = await fetch("/api/products/content", { method: "POST", headers: {
        "Content-Type": "application/json", "Idempotency-Key": createUuidV7()
      }, body: JSON.stringify({ action, skuId, locale, draft, versionId: selected?.id }) });
      const result = await response.json() as { id?: string; issues?: ContentIssue[] };
      if (!response.ok) { setIssues(result.issues ?? null); setMessage(t("content.error")); return; }
      if (action === "save" || action === "generate") setSelectedId(result.id ?? "");
      setMessage(t(action === "ai" ? "content.ai_queued" : "evidence.saved"));
      router.refresh();
    } catch { setMessage(t("content.error")); }
    finally { setSaving(false); }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const read = (key: string) => String(data.get(key) ?? "");
    void send("save", { displayName: read("displayName"), shortDescription: read("shortDescription"),
      fullDescription: read("fullDescription"), searchAliases: read("searchAliases").split("\n").map((line) => line.trim()).filter(Boolean) });
  }

  const shownIssues = issues ?? selected?.issues ?? [];
  return <section className="office-login">
    <h2>{t("content.title")}</h2>
    <label>{t("content.locale")} <select value={locale} onChange={(event) => { setLocale(event.target.value); setSelectedId(""); setIssues(null); }}>
      {locales.map((code) => <option value={code} key={code}>{code.toUpperCase()}</option>)}
    </select></label>
    <p>{t(approved ? "content.approved" : versions.length ? "content.pending" : "content.missing")}</p>
    {approved?.changedFields.length ? <p>{t("content.review_required")} {approved.changedFields.join(", ")}</p> : null}
    {approved?.conflictingFields.length ? <p>{t("content.suspended")} {approved.conflictingFields.join(", ")}</p> : null}
    <details><summary>{t("content.verified_facts")}</summary>
      <ul>{Object.entries(review.facts).map(([field, fact]) => <li key={field}>{locale === "ka" ? fact.labelKa : fact.labelEn} · {String(fact.value)} {fact.unit}</li>)}</ul>
    </details>
    {versions.length ? <label>{t("content.version")} <select value={selected?.id}
      onChange={(event) => { setSelectedId(event.target.value); setIssues(null); }}>
      {versions.map((version) => <option key={version.id} value={version.id}>
        {t(`content.origin.${version.origin}` as TranslationKey)} · {version.dateLabel}
        {version.id === approved?.id ? ` · ${t("content.approved")}` : ""}
      </option>)}
    </select></label> : null}
    <form key={`${locale}:${selected?.id ?? "new"}`} onSubmit={save}>
      <fieldset disabled={archived || saving}>
        <label>{t("content.displayName")} <input name="displayName" maxLength={300} defaultValue={selected?.displayName} /></label>
        <label>{t("content.shortDescription")} <textarea name="shortDescription" maxLength={2000} defaultValue={selected?.shortDescription} /></label>
        <label>{t("content.fullDescription")} <textarea name="fullDescription" rows={7} maxLength={12000} defaultValue={selected?.fullDescription} /></label>
        <label>{t("content.searchAliases")} <textarea name="searchAliases" defaultValue={selected?.searchAliases.join("\n")} /></label>
        <button type="submit">{t("content.save_version")}</button>
        <button type="button" onClick={() => void send("generate")}>{t("content.generate")}</button>
        <button type="button" onClick={() => void send("ai")}>{t("content.ai_proposal")}</button>
        {selected && selected.id !== approved?.id ? <button type="button" disabled={shownIssues.length > 0 || selected.imported}
          onClick={() => void send("approve")}>{t("content.approve_version")}</button> : null}
      </fieldset>
    </form>
    {selected?.imported ? <p>{t("content.imported")}</p> : null}
    {shownIssues.length ? <ul>{shownIssues.map((issue, index) => <li key={index}>
      {t(`content.${issue.field}` as TranslationKey)} · {t(`content.issue.${issue.code}` as TranslationKey)} {issue.phrase}
    </li>)}</ul> : null}
    <p role="status">{message}</p>
  </section>;
}
