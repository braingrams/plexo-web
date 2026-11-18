"use client";

import { forwardRef, useId } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import { cx } from "./cx";

type FieldIds = { id: string; describedBy: string | undefined; invalid: boolean };

export type FieldProps = {
  label: React.ReactNode;
  /** One plain sentence under the box: what to type, or why we ask. */
  help?: React.ReactNode;
  /** What's wrong and how to fix it, in plain words ("Please add a price, like 5,000"). */
  error?: React.ReactNode;
  optional?: boolean;
  /** Visually hide the label (it's still read out). Use sparingly. */
  hideLabel?: boolean;
  id?: string;
  className?: string;
  children: (ids: FieldIds) => React.ReactNode;
};

/** Label + control + help/error, wired together for screen readers. Input/Textarea/Select use it. */
export function Field({ label, help, error, optional, hideLabel, id: idProp, className, children }: FieldProps) {
  const auto = useId();
  const id = idProp ?? `f${auto}`;
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, helpId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cx("plx-field", className)}>
      <label htmlFor={id} className={hideLabel ? "plx-sr-only" : "plx-field__label"}>
        {label}
        {optional ? <span className="plx-field__optional">(optional)</span> : null}
      </label>
      {children({ id, describedBy, invalid: !!error })}
      {error ? (
        <p id={errorId} className="plx-field__error" role="alert">
          <CircleAlert size={16} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="plx-field__help">
          {help}
        </p>
      ) : null}
    </div>
  );
}

type Labelled = Omit<FieldProps, "children" | "className"> & { fieldClassName?: string };

export type InputProps = Labelled & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id">;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, help, error, optional, hideLabel, id, fieldClassName, className, ...rest }, ref) {
  return (
    <Field label={label} help={help} error={error} optional={optional} hideLabel={hideLabel} id={id} className={fieldClassName}>
      {(f) => <input ref={ref} id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid || undefined} className={cx("plx-input", className)} {...rest} />}
    </Field>
  );
});

export type TextareaProps = Labelled & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "id">;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, help, error, optional, hideLabel, id, fieldClassName, className, ...rest }, ref) {
  return (
    <Field label={label} help={help} error={error} optional={optional} hideLabel={hideLabel} id={id} className={fieldClassName}>
      {(f) => <textarea ref={ref} id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid || undefined} className={cx("plx-input", className)} {...rest} />}
    </Field>
  );
});

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectProps = Labelled & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "id"> & { options: SelectOption[]; placeholder?: string };

/** A native select (best on phones), styled to match. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, help, error, optional, hideLabel, id, fieldClassName, className, options, placeholder, ...rest }, ref) {
  return (
    <Field label={label} help={help} error={error} optional={optional} hideLabel={hideLabel} id={id} className={fieldClassName}>
      {(f) => (
        <div className="plx-select">
          <select ref={ref} id={f.id} aria-describedby={f.describedBy} aria-invalid={f.invalid || undefined} className={cx("plx-input", className)} {...rest}>
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={18} className="plx-select__chev" aria-hidden />
        </div>
      )}
    </Field>
  );
});
