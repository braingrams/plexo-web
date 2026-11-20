"use client";

import { useState } from "react";
import { CircleHelp, ExternalLink } from "lucide-react";
import { Button, Modal } from "../ui";
import { HELP_COPY } from "@/lib/dashboardV3/brandDefinition";

const STRATA_URL = (process.env.NEXT_PUBLIC_STRATA_APP_URL || "https://strata.charisol.io").replace(/\/+$/, "");

/**
 * The small (?) beside "Your brand". The ONE place the tool behind the brand is named, for three kinds of reader:
 * someone new to all this, someone who already uses it, and someone who knows design systems.
 */
export function BrandHelp({ onSwitch, canSwitch = true }: { onSwitch?: () => void; canSwitch?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="plx-brandhelp" aria-label="What is my brand?" title="What is my brand?" onClick={() => setOpen(true)}>
        <CircleHelp size={18} aria-hidden />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={HELP_COPY.title} width={600}>
        <div className="plx-brandhelp__body">
          <section>
            <h3>{HELP_COPY.newcomer.heading}</h3>
            <p>{HELP_COPY.newcomer.text}</p>
          </section>
          <section>
            <h3>{HELP_COPY.words.heading}</h3>
            <p>{HELP_COPY.words.text}</p>
          </section>
          <section>
            <h3>{HELP_COPY.strataUser.heading}</h3>
            <p>{HELP_COPY.strataUser.text}</p>
            {onSwitch && canSwitch ? <Button variant="secondary" size="sm" onClick={() => { setOpen(false); onSwitch(); }}>{HELP_COPY.strataUser.action}</Button> : null}
          </section>
          <section>
            <h3>{HELP_COPY.designer.heading}</h3>
            <p>{HELP_COPY.designer.text}</p>
            <a className="plx-btn plx-btn--ghost plx-btn--sm" href={STRATA_URL} target="_blank" rel="noreferrer">{HELP_COPY.designer.link} <ExternalLink size={14} aria-hidden /></a>
          </section>
        </div>
      </Modal>
    </>
  );
}
