"use client";

import { useEffect, useId, useRef, useState } from "react";
import { t, type TranslationKey } from "@khidi/i18n";

export type ReviewPhoto = {
  id: string; url: string; position: number;
  origin?: string; width: number | null; height: number | null; qualityFlags: string[];
};

const qualityLabels: Record<string, TranslationKey> = {
  LOW_RESOLUTION_REVIEW: "review.photo_low_resolution",
  VERY_BRIGHT_REVIEW: "review.photo_bright",
  VERY_DARK_REVIEW: "review.photo_dark",
  BLUR_REVIEW: "review.photo_blur"
};

function PhotoDetails({ photo }: { photo: ReviewPhoto }) {
  return <div className="review-photo-details">
    {photo.width && photo.height ? <p>{t("review.photo_dimensions")}: {photo.width} × {photo.height} px</p> : null}
    {photo.qualityFlags.length ? <ul>{[...new Set(photo.qualityFlags.map((flag) => qualityLabels[flag] ?? "review.photo_attention"))]
      .map((key) => <li key={key}>{t(key)}</li>)}</ul> : null}
  </div>;
}

function PhotoViewer({ photos, initialId, onClose }: { photos: ReviewPhoto[]; initialId: string; onClose: () => void }) {
  const [index, setIndex] = useState(photos.findIndex((photo) => photo.id === initialId));
  const [zoom, setZoom] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const titleId = useId(), helpId = useId();
  const photo = photos[index]!;
  const move = (offset: number) => { setIndex((index + offset + photos.length) % photos.length); setZoom(false); };

  useEffect(() => {
    const element = dialog.current!, previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    close.current?.focus();
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} className="review-photo-dialog" aria-labelledby={titleId} aria-describedby={helpId}
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="review-heading">
      <h2 id={titleId}>{t("review.photo")} {photo.position} <small>({index + 1} / {photos.length})</small></h2>
      <button type="button" className="review-button" ref={close} onClick={onClose}>{t("review.close_photo")}</button>
    </div>
    <div className="review-photo-stage" data-zoom={zoom}>
      <img src={photo.url} alt={`${t("review.photo")} ${photo.position}`} />
    </div>
    <div className="review-photo-viewer-tools">
      {photos.length > 1 ? <button type="button" className="review-button" onClick={() => move(-1)}>{t("review.previous_photo")}</button> : null}
      <button type="button" className="review-button" aria-pressed={zoom} onClick={() => setZoom(!zoom)}>{t(zoom ? "review.photo_fit" : "review.photo_zoom")}</button>
      {photos.length > 1 ? <button type="button" className="review-button" onClick={() => move(1)}>{t("review.next_photo")}</button> : null}
    </div>
    <PhotoDetails photo={photo} />
    <p id={helpId} className="review-quiet">{t("review.photo_preview_help")}</p>
  </dialog>;
}

export function CatalogReviewPhotos({ photos, selected, onSelect, proposedPhotoId, disabled }: {
  photos: ReviewPhoto[]; selected: string; onSelect: (id: string) => void;
  proposedPhotoId: string | null; disabled: boolean;
}) {
  const [open, setOpen] = useState<string>();
  return <>
    <fieldset className="review-photos" disabled={disabled}>
      <legend>{t("review.choose_photo")}</legend>
      {photos.map((photo) => <div className="review-photo-card" key={photo.id} data-selected={selected === photo.id}>
        <button type="button" className="review-photo-preview" onClick={() => setOpen(photo.id)}
          aria-label={`${t("review.enlarge_photo")} ${photo.position}`}>
          <img src={photo.url} alt={`${t("review.photo")} ${photo.position}`} loading="lazy" decoding="async" />
          <span>{t("review.enlarge_photo")}</span>
        </button>
        <label className="review-photo-choice">
          <input type="radio" name="photo" value={photo.id} checked={selected === photo.id} onChange={() => onSelect(photo.id)} />
          <span>{t("review.photo")} {photo.position}</span>
          {photo.origin ? <small>{t(photo.origin === "UPLOAD" ? "review.upload" : "review.generated")}</small>
            : photo.position === 1 ? <small>{t("review.old_main")}</small> : null}
          {photo.id === proposedPhotoId ? <small>{t("review.suggested_photo")}</small> : null}
        </label>
        <PhotoDetails photo={photo} />
      </div>)}
    </fieldset>
    <p className="review-quiet review-photo-help">{t("review.photo_flags_help")}</p>
    {open ? <PhotoViewer photos={photos} initialId={open} onClose={() => setOpen(undefined)} /> : null}
  </>;
}
