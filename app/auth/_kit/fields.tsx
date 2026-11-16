"use client";

import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { AlertCircle, Check, Eye, EyeOff } from "lucide-react";
import { passwordChecks } from "./passwordRules";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string | null;
  hint?: ReactNode;
  /** Shown on the right of the label (e.g. "Forgot password?"). */
  labelAction?: ReactNode;
  optional?: boolean;
};

/** Labelled input with an inline error. The error and hint are linked to the input for screen readers. */
export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField({ label, error, hint, labelAction, optional, className = "", id: idProp, ...rest }, ref) {
  const generated = useId();
  const id = idProp ?? generated;
  const describedBy = [error ? `${id}-err` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="ax-field">
      <div className="ax-label-row">
        <label htmlFor={id} className="ax-label">{label}{optional ? <span className="ax-optional"> (optional)</span> : null}</label>
        {labelAction}
      </div>
      <input ref={ref} id={id} className={`ax-input ${className}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...rest} />
      {error ? <p id={`${id}-err`} className="ax-field-error"><AlertCircle size={14} aria-hidden="true" />{error}</p> : null}
      {hint ? <div id={`${id}-hint`} className="ax-hint">{hint}</div> : null}
    </div>
  );
});

type PasswordProps = Omit<FieldProps, "type"> & {
  /** Show the password rules, ticking each off as it is met (appears once the person starts typing). */
  showRules?: boolean;
  /** Positive note under the field, e.g. "Passwords match". */
  okNote?: string | null;
};

/** Password input with a show/hide button and (optionally) live rules. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordProps>(function PasswordField({ showRules = false, okNote, error, hint, value, label, labelAction, id: idProp, ...rest }, ref) {
  const [shown, setShown] = useState(false);
  const generated = useId();
  const id = idProp ?? generated;
  const text = typeof value === "string" ? value : "";
  const rulesId = `${id}-rules`;
  return (
    <div className="ax-field">
      <div className="ax-label-row">
        <label htmlFor={id} className="ax-label">{label}</label>
        {labelAction}
      </div>
      <div className="ax-input-wrap">
        <input
          ref={ref}
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          className="ax-input ax-has-trailing"
          aria-invalid={error ? true : undefined}
          aria-describedby={[error ? `${id}-err` : null, showRules && text ? rulesId : null].filter(Boolean).join(" ") || undefined}
          {...rest}
        />
        <button type="button" className="ax-trailing" onClick={() => setShown((v) => !v)} aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
          {shown ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
        </button>
      </div>
      {error ? <p id={`${id}-err`} className="ax-field-error"><AlertCircle size={14} aria-hidden="true" />{error}</p> : null}
      {okNote && !error ? <p className="ax-field-error ax-field-ok"><Check size={14} aria-hidden="true" />{okNote}</p> : null}
      {showRules && text ? (
        <ul id={rulesId} className="ax-rules" aria-label="Password rules">
          {passwordChecks(text).map((c) => (
            <li key={c.id} className="ax-rule" data-met={c.met}>
              <span className="ax-rule-dot"><Check size={10} strokeWidth={3.5} aria-hidden="true" /></span>
              <span>{c.label}<span className="ax-sr">{c.met ? " (done)" : " (needed)"}</span></span>
            </li>
          ))}
        </ul>
      ) : null}
      {hint && !(showRules && text) ? <div className="ax-hint">{hint}</div> : null}
    </div>
  );
});
