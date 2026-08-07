"use client";

import { useState } from "react";
import { TemplatePreviewModal } from "../TemplatePreviewModal";

export function PreviewButton({ templateId }: { templateId: string }) {
  const [previewing, setPreviewing] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewing(true)}
        className="rounded-xl border border-slate-800 bg-slate-900/80 px-6 py-3 text-sm font-semibold text-slate-200 hover:border-slate-700 hover:bg-slate-800 hover:text-white transition-all flex items-center gap-2"
      >
        Preview
      </button>
      {previewing && <TemplatePreviewModal templateId={templateId} onClose={() => setPreviewing(false)} />}
    </>
  );
}
