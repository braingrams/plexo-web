/**
 * SOL's mascot: a friendly little astronaut. The art lives in /public/brand/sol as transparent WebP files, so the
 * character sits straight on any card in light or dark with no box behind it.
 *
 *  - `waving` (or pose "wave") plays a short looping wave. People who ask their device for less motion get the
 *    same pose as a still picture instead (prefers-reduced-motion), via the <picture> source below.
 *  - pose "idle" and "working" are still pictures for quieter moments (a hand on the hip; using a hologram panel).
 *
 * `size` is the height in pixels; the width follows the picture. Decorative by default: the surrounding text carries
 * the meaning. Pass `title` to give it a text alternative.
 */
export type SolPose = "wave" | "idle" | "working";

const ART: Record<SolPose, { src: string; still: string }> = {
  wave: { src: "/brand/sol/sol-wave.webp", still: "/brand/sol/sol-wave-still.webp" },
  idle: { src: "/brand/sol/sol-pose-idle.webp", still: "/brand/sol/sol-pose-idle.webp" },
  working: { src: "/brand/sol/sol-pose-working.webp", still: "/brand/sol/sol-pose-working.webp" },
};

export function SolMascot({ size = 80, waving = false, pose, title }: { size?: number; waving?: boolean; pose?: SolPose; title?: string }) {
  const art = ART[pose ?? (waving ? "wave" : "idle")];
  return (
    <picture>
      {art.src !== art.still ? <source media="(prefers-reduced-motion: reduce)" srcSet={art.still} type="image/webp" /> : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- an animated WebP: next/image would flatten it to one frame */}
      <img
        src={art.src}
        alt={title ?? ""}
        aria-hidden={title ? undefined : true}
        height={size}
        style={{ height: size, width: "auto", display: "block", userSelect: "none", pointerEvents: "none" }}
        decoding="async"
        draggable={false}
      />
    </picture>
  );
}
