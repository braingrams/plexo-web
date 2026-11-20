import { SolGlyph } from "../../_v3/sol/SolGlyph";

/** SOL's mark everywhere it appears: the sun glyph (sol = sun). One source so every button, panel and sidebar entry matches. */
export function SolIcon({ size = 16, className }: { size?: number; className?: string }) {
  return <span className={className} style={{ display: "inline-flex" }}><SolGlyph size={size} /></span>;
}
