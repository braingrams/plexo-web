import { ImageOff } from "lucide-react";

export type SnapshotImage = {
  src?: string;
  alt: string;
  label: string;
};

function Frame({ src, alt, label }: SnapshotImage) {
  return (
    <div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] shadow-lg shadow-black/10 overflow-hidden backdrop-blur-xl">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[var(--surface-border)]">
        <span className="w-2 h-2 rounded-full bg-red-400/70" />
        <span className="w-2 h-2 rounded-full bg-yellow-400/70" />
        <span className="w-2 h-2 rounded-full bg-green-400/70" />
        <span className="ml-2 text-[10px] font-mono text-[var(--text-faint)] truncate">{label}</span>
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- these are static local
        // screenshots; next/image's optimizer rejects this PNG encoding on decode.
        <img src={src} alt={alt} loading="lazy" className="w-full h-auto block" />
      ) : (
        <div className="aspect-[16/10] flex flex-col items-center justify-center gap-1.5 text-[var(--text-faint)] bg-[var(--bg-1)]">
          <ImageOff className="w-5 h-5" />
          <span className="text-[11px] font-medium">Screenshot coming soon</span>
        </div>
      )}
    </div>
  );
}

// Each row is 1 or 2 screenshots — a row of 2 sits side by side on wider screens
// (e.g. two views of the same screen), a row of 1 spans the full width. Rows stack
// vertically so every image stays large and legible.
export function Snapshot({ rows }: { rows: SnapshotImage[][] }) {
  return (
    <div className="space-y-4">
      {rows.map((row, i) => (
        <div key={i} className={row.length > 1 ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : ""}>
          {row.map((img, j) => (
            <Frame key={j} {...img} />
          ))}
        </div>
      ))}
    </div>
  );
}
