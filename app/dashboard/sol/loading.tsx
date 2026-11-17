import { SolSplash } from "../_v3/sol/SolSplash";

/**
 * Shown while any /dashboard/sol route (chat, settings, memory) is still loading — before its
 * components exist, so there is nothing else to show.
 * - New dashboard (inside the Plexo shell, where the brand tokens exist): the SOL splash — lime icon on the
 *   page's own light or dark background, filling the content area, sidebar and top bar staying put.
 * - Classic dashboard (no shell, no tokens): its own dark surface, as before.
 */
export default function SolLoading() {
  return (
    <>
      <style>{`
        .sol-load-classic { position: fixed; inset: 0; background: #060409; }
        .sol-load-v3 { display: none; }
        [data-plexo-v3] .sol-load-classic { display: none; }
        [data-plexo-v3] .sol-load-v3 { display: block; }
      `}</style>
      <div className="sol-load-classic" />
      <div className="sol-load-v3">
        <SolSplash />
      </div>
    </>
  );
}
