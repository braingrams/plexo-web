"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/app/auth/_kit/ui";

export function CopyKey({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }).catch(() => undefined);
      }}
    >
      {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
      {copied ? "Copied" : "Copy key"}
    </Button>
  );
}
