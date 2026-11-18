"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { countryFlag, countryName, countryOptions } from "@/lib/countries";
import { T } from "./skin";

type Props = {
  value: string | null;
  onChange: (code: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
};

/** A searchable country picker (type "ni" for Nigeria). Keyboard and screen-reader friendly. */
export function CountrySelect({ value, onChange, id, placeholder = "Choose your country", disabled, autoFocus, invalid }: Props) {
  const uid = useId();
  const inputId = id ?? `${uid}-input`;
  const listId = `${uid}-list`;
  const all = useMemo(() => countryOptions(), []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return all;
    // Names that start with what they typed come first ("ni" -> Nicaragua, Niger, Nigeria before Afghanistan).
    const rank = (c: { code: string; name: string }) => (c.code.toLowerCase() === q ? 0 : c.name.toLowerCase().startsWith(q) ? 1 : 2);
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q).sort((a, b) => rank(a) - rank(b));
  }, [all, q]);
  const label = value ? `${countryFlag(value)} ${countryName(value)}` : "";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView?.({ block: "nearest" });
  }, [active, open]);

  function openList() {
    if (open) return;
    const at = value ? all.findIndex((c) => c.code === value) : 0;
    setActive(Math.max(0, at));
    setOpen(true);
  }

  function pick(code: string) {
    onChange(code);
    setOpen(false);
    setQuery("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      else setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (shown[active]) pick(shown[active].code);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation(); // don't also close a surrounding dialog
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div ref={wrap} style={{ position: "relative", width: "100%" }}>
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={open && shown[active] ? `${listId}-${shown[active].code}` : undefined}
        autoComplete="off"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus={autoFocus}
        disabled={disabled}
        value={open ? query : label}
        placeholder={open && label ? label : placeholder}
        onClick={openList}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKey}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: T.field,
          color: T.text,
          border: `1px solid ${invalid ? T.danger : T.border}`,
          borderRadius: T.radius,
          padding: "0.8rem 2.4rem 0.8rem 1rem",
          fontSize: "0.95rem",
          fontFamily: T.font,
          outline: "none",
        }}
      />
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: T.muted, pointerEvents: "none" }}>
        <path d="m6 9 6 6 6-6" />
      </svg>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{ position: "absolute", zIndex: 60, left: 0, right: 0, top: "calc(100% + 6px)", maxHeight: 240, overflowY: "auto", margin: 0, padding: 4, listStyle: "none", background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, boxShadow: "0 18px 40px rgba(0,0,0,0.45)" }}
        >
          {shown.length === 0 && <li style={{ padding: "0.7rem 0.8rem", color: T.muted, fontSize: "0.9rem" }}>No country matches “{query}”.</li>}
          {shown.map((c, i) => (
            <li
              key={c.code}
              id={`${listId}-${c.code}`}
              role="option"
              aria-selected={c.code === value}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c.code);
              }}
              style={{ padding: "0.55rem 0.8rem", borderRadius: 8, cursor: "pointer", fontSize: "0.92rem", color: T.text, background: i === active ? T.hover : "transparent", display: "flex", gap: 10, alignItems: "center", fontWeight: c.code === value ? 700 : 400 }}
            >
              <span aria-hidden>{countryFlag(c.code)}</span>
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
