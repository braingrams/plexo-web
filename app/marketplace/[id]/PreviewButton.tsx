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
        className="rounded-lg border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-500 hover:text-white"
      >
        Preview
      </button>
      {previewing && <TemplatePreviewModal templateId={templateId} onClose={() => setPreviewing(false)} />}
    </>
  );
}
