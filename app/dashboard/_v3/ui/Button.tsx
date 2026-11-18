"use client";

import Link from "next/link";
import { forwardRef } from "react";
import { LoaderCircle } from "lucide-react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "strong" | "danger" | "link";
export type ButtonSize = "sm" | "md" | "lg";

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  /** Square icon-only button — give it an `aria-label`. */
  iconOnly?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export type ButtonProps = Common &
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    /** Shows a spinner, keeps the button's width, and blocks clicks. */
    loading?: boolean;
    /** What a screen reader hears while loading (default "Working…"). */
    loadingLabel?: string;
  };

export function buttonClass({ variant = "primary", size = "md", fullWidth, iconOnly }: Common, extra?: string): string {
  return cx("plx-btn", `plx-btn--${variant}`, size !== "md" && `plx-btn--${size}`, fullWidth && "plx-btn--full", iconOnly && "plx-btn--icon", extra);
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, fullWidth, iconOnly, leftIcon, rightIcon, loading, loadingLabel = "Working…", className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, fullWidth, iconOnly }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading ? "true" : undefined}
      {...rest}
    >
      <span className="plx-btn__label">
        {leftIcon}
        {children}
        {rightIcon}
      </span>
      {loading ? (
        <span className="plx-btn__spinner">
          <LoaderCircle size={18} className="plx-spin" aria-hidden />
          <span className="plx-sr-only">{loadingLabel}</span>
        </span>
      ) : null}
    </button>
  );
});

export type ButtonLinkProps = Common & Omit<React.ComponentProps<typeof Link>, "className"> & { className?: string };

/** A link that looks like a button (navigation should be a link, not a button). */
export function ButtonLink({ variant, size, fullWidth, iconOnly, leftIcon, rightIcon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClass({ variant, size, fullWidth, iconOnly }, className)} {...rest}>
      <span className="plx-btn__label">
        {leftIcon}
        {children}
        {rightIcon}
      </span>
    </Link>
  );
}
