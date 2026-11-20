"use client";

import { useEffect, useRef, useState } from "react";
import { t } from "@khidi/i18n";

export type LightboxImage = { url: string; caption?: string };
type Open = { images: LightboxImage[]; index: number };

/** A modal photo viewer: arrows or ←/→ to step through, Esc or a click outside the photo to close. */
export function useLightbox() {
  const [state, setState] = useState<Open | null>(null);
  return {
    open: (images: LightboxImage[], index = 0) => { if (images.length) setState({ images, index: Math.min(index, images.length - 1) }); },
    node: state ? <Lightbox {...state} onIndex={index => setState(s => s && { ...s, index })} onClose={() => setState(null)}/> : null
  };
}

function Lightbox({ images, index, onIndex, onClose }: Open & { onIndex: (i: number) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const image = images[index]!, many = images.length > 1;
  const go = (by: number) => onIndex((index + by + images.length) % images.length);
  return <dialog ref={ref} className="lightbox" aria-label={image.caption ?? t("lightbox.title")}
    onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    onKeyDown={e => { if (many && e.key === "ArrowLeft") go(-1); if (many && e.key === "ArrowRight") go(1); }}>
    <figure>
      <img src={image.url} alt={image.caption ?? ""}/>
      <figcaption>{image.caption}{many && <span> · {index + 1} / {images.length}</span>}</figcaption>
    </figure>
    {many && <>
      <button type="button" className="lightbox-prev" aria-label={t("lightbox.prev")} onClick={() => go(-1)}>‹</button>
      <button type="button" className="lightbox-next" aria-label={t("lightbox.next")} onClick={() => go(1)}>›</button></>}
    <button type="button" className="lightbox-close" aria-label={t("lightbox.close")} onClick={onClose} autoFocus>×</button>
  </dialog>;
}
