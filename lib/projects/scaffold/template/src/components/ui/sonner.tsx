import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// Show a toast anywhere with: import { toast } from "sonner"; toast.success("Saved");
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
