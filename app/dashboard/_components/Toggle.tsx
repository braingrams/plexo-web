"use client";

type Props = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
};

/** Shared checkbox-backed toggle switch, styled via the .toggle/.toggle-track/.toggle-thumb classes in globals.css. */
export function Toggle({ checked, onChange, disabled, label }: Props) {
  return (
    <label className="toggle" aria-label={label} style={{ opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer" }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" />
      <span className="toggle-thumb" />
    </label>
  );
}
