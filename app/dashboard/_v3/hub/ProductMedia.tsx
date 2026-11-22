"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ImagePlus, Package, Star, X } from "lucide-react";
import type { HubProduct } from "@/lib/dashboardV3/hubData";
import { MAX_PRODUCT_IMAGES, MAX_RELATED, makeCover, moveImage, removeImage, toggleRelated } from "@/lib/dashboardV3/productList";
import { errMsg, hubApi } from "./hubApi";

/**
 * A product's pictures: add as many as you like and use the arrows to put them in order. The first picture is the cover
 * people see in the shop; every other one is in the gallery on the product's own page.
 */
export function ProductImages({ images, onChange, onError }: { images: string[]; onChange: (next: string[]) => void; onError: (message: string | null) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function add(files: FileList) {
    setUploading(true);
    onError(null);
    let next = images;
    try {
      for (const file of Array.from(files).slice(0, MAX_PRODUCT_IMAGES - images.length)) {
        const body = new FormData();
        body.append("file", file);
        const { url } = await hubApi<{ url: string }>("/api/v1/media/upload", { method: "POST", body }, "We couldn't upload that photo. Try a smaller picture.");
        next = [...next, url];
        onChange(next);
      }
    } catch (e) {
      onError(errMsg(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="plx-pimgs">
      <div className="plx-pimgs__head">
        <b>Photos</b>
        <span className="plx-small">{images.length ? "The first photo is the one your shop shows. Add more to show it from every side." : "Add a photo so people can see what they're buying."}</span>
      </div>
      <ul className="plx-pimgs__grid">
        {images.map((url, i) => (
          <li key={url} className="plx-pimg" data-cover={i === 0 || undefined}>
            <img src={url} alt={i === 0 ? "Cover photo" : `Photo ${i + 1}`} />
            {i === 0 ? <span className="plx-pimg__tag"><Star size={12} aria-hidden /> Cover</span> : null}
            <span className="plx-pimg__bar">
              {i > 0 ? <button type="button" aria-label={`Make photo ${i + 1} the cover`} title="Make this the cover" onClick={() => onChange(makeCover(images, i))}><Star size={16} aria-hidden /></button> : null}
              <button type="button" aria-label="Move earlier" title="Move earlier" disabled={i === 0} onClick={() => onChange(moveImage(images, i, -1))}><ArrowLeft size={16} aria-hidden /></button>
              <button type="button" aria-label="Move later" title="Move later" disabled={i === images.length - 1} onClick={() => onChange(moveImage(images, i, 1))}><ArrowRight size={16} aria-hidden /></button>
              <button type="button" aria-label={`Remove photo ${i + 1}`} title="Remove" onClick={() => onChange(removeImage(images, i))}><X size={16} aria-hidden /></button>
            </span>
          </li>
        ))}
        {images.length < MAX_PRODUCT_IMAGES ? (
          <li>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files?.length && add(e.target.files)} />
            <button type="button" className="plx-pimg plx-pimg--add" onClick={() => fileRef.current?.click()} disabled={uploading}>
              <ImagePlus size={24} aria-hidden />
              <span>{uploading ? "Uploading…" : images.length ? "Add more photos" : "Add photos"}</span>
            </button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/** "Products I sell together": up to three other products shown on this one's page as "Bought together". */
export function RelatedPicker({ options, chosen, onChange }: { options: HubProduct[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  if (options.length === 0) return null;
  const full = chosen.length >= MAX_RELATED;
  return (
    <section className="plx-pt__sec" aria-label="Products I sell together">
      <div>
        <b>Products I sell together</b>
        <span className="plx-small" style={{ display: "block" }}>Pick up to {MAX_RELATED}. They show on this product&apos;s page as &ldquo;Bought together&rdquo;. Leave empty and that part just doesn&apos;t show.</span>
      </div>
      <ul className="plx-prel">
        {options.map((p) => {
          const on = chosen.includes(p.id);
          return (
            <li key={p.id}>
              <label className="plx-prel__row" data-on={on || undefined} data-disabled={!on && full || undefined}>
                <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onChange(toggleRelated(chosen, p.id))} />
                <span className="plx-hrow__thumb" style={{ width: 36, height: 36, borderRadius: 8 }}>{p.imageUrl ? <img src={p.imageUrl} alt="" /> : <Package size={16} aria-hidden />}</span>
                <span className="plx-hrow__title">{p.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {full ? <p className="plx-small">That&apos;s three. Untick one to pick a different product.</p> : null}
    </section>
  );
}

