"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { Modal } from "../../ui/Modal";
import { parseSolStudioHref } from "@/lib/dashboardV3/solStudioLink";
import { SolStudio } from "./SolStudio";
import type { StudioApi, StudioEngine } from "./types";
import { useStudioChat } from "./useStudioChat";
import { useStudioScript } from "./useStudioScript";

type Common = { title: string; onDone?: () => void };
export type ChatRun = Common & { kind: "chat"; prompt: string; siteId?: string | null };
export type ScriptRun<R = unknown> = Common & { kind: "script"; script: (api: StudioApi) => Promise<R>; onFinished?: (result: R) => void };
type Run = (ChatRun | ScriptRun) & { key: number };

type StudioHandle = {
  /** Opens SOL Studio and starts a real SOL conversation from this request. */
  runChat: (run: Omit<ChatRun, "kind">) => void;
  /** Opens SOL Studio and runs real work as SOL's steps. */
  runScript: <R>(run: Omit<ScriptRun<R>, "kind">) => void;
};

const StudioContext = createContext<StudioHandle | null>(null);

/** Open SOL Studio from anywhere in the dashboard. */
export function useSolStudio(): StudioHandle {
  const ctx = useContext(StudioContext);
  if (!ctx) throw new Error("useSolStudio must be used inside <SolStudioProvider>");
  return ctx;
}

/** Fires once each time SOL finishes. */
function useOnDone(engine: StudioEngine, onDone?: () => void) {
  const fired = useRef(false);
  useEffect(() => {
    if (engine.state === "done" && !fired.current) {
      fired.current = true;
      onDone?.();
    }
    if (engine.state !== "done") fired.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.state]);
}

function ChatRunView({ run, onClose }: { run: ChatRun; onClose: () => void }) {
  const engine = useStudioChat({ prompt: run.prompt, siteId: run.siteId });
  useOnDone(engine, run.onDone);
  return <SolStudio engine={engine} title="SOL" allowFollowUp onClose={onClose} doneActions={<Button onClick={onClose}>Done</Button>} />;
}

function ScriptRunView({ run, onClose, isCurrent }: { run: ScriptRun; onClose: () => void; isCurrent: () => boolean }) {
  const engine = useStudioScript(run.script, {
    // Closed while SOL was still working: don't change the screen behind the owner's back.
    onFinished: (result) => {
      if (isCurrent()) run.onFinished?.(result);
    },
  });
  useOnDone(engine, () => isCurrent() && run.onDone?.());
  return <SolStudio engine={engine} title="SOL" onClose={onClose} doneActions={<Button onClick={onClose}>Done</Button>} />;
}

/**
 * Mount once in the dashboard. Gives every screen SOL Studio in a dialog, and turns any
 * "Let SOL do it" link made with solStudioHref() into "SOL starts right here".
 */
export function SolStudioProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<Run | null>(null);
  const keyRef = useRef(0);
  const currentKey = useRef<number | null>(null);

  const open = useCallback((next: ChatRun | ScriptRun) => {
    const key = ++keyRef.current;
    currentKey.current = key;
    setRun({ ...next, key } as Run);
  }, []);
  const close = useCallback(() => {
    currentKey.current = null;
    setRun(null);
  }, []);

  const handle = useMemo<StudioHandle>(
    () => ({
      runChat: (r) => open({ ...r, kind: "chat" }),
      runScript: (r) => open({ ...r, kind: "script" } as ScriptRun),
    }),
    [open],
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      const parsed = parseSolStudioHref(link.getAttribute("href") ?? "", window.location.origin);
      if (!parsed) return;
      e.preventDefault();
      e.stopPropagation();
      open({ kind: "chat", title: "SOL is on it", prompt: parsed.prompt, siteId: parsed.siteId });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [open]);

  return (
    <StudioContext.Provider value={handle}>
      {children}
      <Modal open={!!run} onClose={close} title={run?.title ?? "SOL"} width={760} closeOnBackdrop={false} hideClose>
        {run ? (
          <div style={{ height: "min(620px, 68dvh)", border: "1px solid var(--plx-border)", borderRadius: "var(--plx-radius-card, 16px)", overflow: "hidden", display: "flex" }}>
            {run.kind === "chat" ? <ChatRunView key={run.key} run={run} onClose={close} /> : <ScriptRunView key={run.key} run={run} onClose={close} isCurrent={() => currentKey.current === run.key} />}
          </div>
        ) : null}
      </Modal>
    </StudioContext.Provider>
  );
}
