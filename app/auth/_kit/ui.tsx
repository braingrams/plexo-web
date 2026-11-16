"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";

export function Button({ variant = "primary", loading = false, inline = false, className = "", children, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost"; loading?: boolean; inline?: boolean }) {
  return (
    <button {...rest} disabled={disabled || loading} aria-busy={loading || undefined} className={`ax-btn ax-btn-${variant}${inline ? " ax-btn-inline" : ""} ${className}`}>
      {loading ? <span className="ax-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Alert({ tone, title, children }: { tone: "error" | "success" | "info" | "warning"; title?: string; children: ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "info" ? Info : AlertCircle;
  return (
    <div className={`ax-alert ax-alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={18} aria-hidden="true" />
      <div>
        {title ? <p className="ax-alert-title">{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Divider({ children = "or" }: { children?: ReactNode }) {
  return <div className="ax-divider" role="separator">{children}</div>;
}

export function PageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="ax-head">
      <h1 className="ax-title">{title}</h1>
      {children ? <p className="ax-sub">{children}</p> : null}
    </header>
  );
}
