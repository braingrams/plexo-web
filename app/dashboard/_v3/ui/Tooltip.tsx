"use client";

import { cloneElement, isValidElement, useId, useState } from "react";

/** A short hint on hover or keyboard focus. The trigger must be focusable (a button or link). */
export function Tooltip({ content, side = "top", children }: { content: string; side?: "top" | "bottom"; children: React.ReactElement<{ "aria-describedby"?: string }> }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = isValidElement(children) ? cloneElement(children, { "aria-describedby": id }) : children;
  return (
    <span
      className="plx-tip"
      data-open={open}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      {trigger}
      <span role="tooltip" id={id} className="plx-tip__bubble" data-side={side}>
        {content}
      </span>
    </span>
  );
}
