"use client";

import { Moon, Sun } from "lucide-react";

const KEY = "theme"; // the same key the dashboard's theme switch uses, so a choice carries across

/** Switches the sign-in screens between light and dark. Follows the device until someone picks. */
export function ThemeToggle() {
  function toggle() {
    const root = document.querySelector<HTMLElement>(".ax-root");
    if (!root) return;
    const current = root.dataset.axTheme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.axTheme = next;
    try { window.localStorage.setItem(KEY, next); } catch { /* private mode: the choice just lasts for this visit */ }
  }
  return (
    <button type="button" className="ax-theme-toggle" onClick={toggle} aria-label="Switch between light and dark">
      <Moon className="ax-moon" size={20} aria-hidden="true" />
      <Sun className="ax-sun" size={20} aria-hidden="true" />
    </button>
  );
}

/** Runs before first paint: applies a saved light/dark choice, otherwise leaves it to the device setting. */
export const themeInitScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.currentScript.parentElement.dataset.axTheme=t}}catch(e){}`;
