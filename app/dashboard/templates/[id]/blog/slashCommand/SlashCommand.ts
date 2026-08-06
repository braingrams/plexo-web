import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { buildSlashCommandItems, type SlashCommandItem } from "./items";

const MENU_STYLE: Partial<CSSStyleDeclaration> = {
  background: "#161a26",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  boxShadow: "0 12px 32px rgba(0,0,0,0.45)",
  padding: "6px",
  minWidth: "220px",
  maxHeight: "320px",
  overflowY: "auto",
  fontFamily: "inherit",
  zIndex: "1000",
};

function renderMenu(items: SlashCommandItem[], selectedIndex: number, onPick: (index: number) => void): HTMLElement {
  const el = document.createElement("div");
  Object.assign(el.style, MENU_STYLE);

  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "No matching blocks";
    empty.style.padding = "8px 10px";
    empty.style.fontSize = "0.8rem";
    empty.style.color = "rgba(240,242,255,0.4)";
    el.appendChild(empty);
    return el;
  }

  items.forEach((item, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.style.display = "block";
    row.style.width = "100%";
    row.style.textAlign = "left";
    row.style.padding = "8px 10px";
    row.style.borderRadius = "6px";
    row.style.border = "none";
    row.style.cursor = "pointer";
    row.style.background = i === selectedIndex ? "rgba(139,92,246,0.15)" : "transparent";
    row.style.color = i === selectedIndex ? "#a78bfa" : "#f0f2ff";

    const title = document.createElement("div");
    title.textContent = item.title;
    title.style.fontSize = "0.85rem";
    title.style.fontWeight = "600";
    row.appendChild(title);

    const desc = document.createElement("div");
    desc.textContent = item.description;
    desc.style.fontSize = "0.72rem";
    desc.style.color = "rgba(240,242,255,0.4)";
    row.appendChild(desc);

    row.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep editor focus/selection intact through the click
      onPick(i);
    });

    el.appendChild(row);
  });

  return el;
}

/**
 * Gutenberg-style "/" block inserter, built on @tiptap/suggestion's modern mount() API
 * (Floating UI positioning handled by the plugin itself — no manual coordinate math or
 * extra positioning library needed). Renders a plain DOM menu rather than a React
 * component since this runs inside a ProseMirror plugin, outside React's render tree.
 */
export const SlashCommand = Extension.create<{ onUploadImage: () => Promise<string | null> }>({
  name: "slashCommand",

  addOptions() {
    return { onUploadImage: async () => null };
  },

  addProseMirrorPlugins() {
    const items = buildSlashCommandItems(this.options.onUploadImage);

    let selectedIndex = 0;
    let currentItems: SlashCommandItem[] = items;
    let menuEl: HTMLElement | null = null;
    let unmount: (() => void) | null = null;
    let pick: ((index: number) => void) | null = null;

    function rerender() {
      if (!menuEl) return;
      const next = renderMenu(currentItems, selectedIndex, (i) => pick?.(i));
      menuEl.replaceWith(next);
      menuEl = next;
    }

    const suggestionOptions: Omit<SuggestionOptions<SlashCommandItem>, "editor"> = {
      char: "/",
      startOfLine: false,
      allowSpaces: false,
      items: ({ query }) => {
        const q = query.toLowerCase();
        currentItems = q
          ? items.filter((item) => item.title.toLowerCase().includes(q) || item.keywords.some((k) => k.includes(q)))
          : items;
        selectedIndex = 0;
        return currentItems;
      },
      command: ({ editor, range, props }) => {
        props.run(editor, range);
      },
      render: () => ({
        onStart: (props) => {
          pick = (i) => {
            const item = currentItems[i];
            if (item) props.command(item);
          };
          menuEl = renderMenu(currentItems, selectedIndex, (i) => pick?.(i));
          unmount = props.mount(menuEl);
        },
        onUpdate: () => {
          rerender();
        },
        onKeyDown: ({ event }) => {
          if (event.key === "ArrowDown") {
            selectedIndex = (selectedIndex + 1) % Math.max(currentItems.length, 1);
            rerender();
            return true;
          }
          if (event.key === "ArrowUp") {
            selectedIndex = (selectedIndex - 1 + Math.max(currentItems.length, 1)) % Math.max(currentItems.length, 1);
            rerender();
            return true;
          }
          if (event.key === "Enter") {
            pick?.(selectedIndex);
            return true;
          }
          if (event.key === "Escape") {
            unmount?.();
            return true;
          }
          return false;
        },
        onExit: () => {
          unmount?.();
          menuEl = null;
          unmount = null;
          pick = null;
        },
      }),
    };

    return [Suggestion({ editor: this.editor, ...suggestionOptions })];
  },
});
