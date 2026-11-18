/**
 * Drag and drop on an email written as HTML.
 *
 * The preview is a copy of the HTML where every element carries a number (data-plx-id). A small script inside the preview
 * lets people drag blocks around; it only reports "move 12 after 30" to the editor. The editor applies that to the real HTML
 * here, by numbering the same elements the same way, so what you see and what is saved can never drift apart.
 * Nothing here runs unless someone actually drags, so pasted HTML is left exactly as it is until then.
 */
import { cleanEmailHtml, fillMergeTags, sampleValues } from "./mergeTags";

export type Pos = "before" | "after" | "inside";
export type BlockKind = "text" | "image" | "button" | "divider" | "space";
export type DragEdit =
  | { type: "move"; id: number; target: number | null; pos: Pos }
  | { type: "insert"; kind: BlockKind; target: number | null; pos: Pos }
  | { type: "insertImage"; url: string; alt: string; target: number | null; pos: Pos }
  | { type: "text"; id: number; html: string }
  /** Put a merge tag after the last text on the page (when there is no cursor to put it at). */
  | { type: "appendTag"; tag: string }
  | { type: "remove"; id: number }
  | { type: "duplicate"; id: number };

export const BLOCKS: { kind: BlockKind; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "image", label: "Picture" },
  { kind: "button", label: "Button" },
  { kind: "divider", label: "Line" },
  { kind: "space", label: "Space" },
];

const INNER: Record<BlockKind, string> = {
  text: '<p style="margin:0 0 12px;font:16px/1.5 Arial,Helvetica,sans-serif;color:#333333;">Write your text here.</p>',
  image: '<img src="https://placehold.co/560x200/e5e7eb/6b7280?text=Your+picture" alt="" width="560" style="display:block;max-width:100%;height:auto;border:0;">',
  button: '<a href="https://example.com" style="display:inline-block;padding:12px 24px;background:#111827;color:#ffffff;font:600 16px Arial,Helvetica,sans-serif;text-decoration:none;border-radius:6px;">Click here</a>',
  divider: '<hr style="border:0;border-top:1px solid #e5e7eb;margin:16px 0;">',
  space: '<div style="height:24px;line-height:24px;font-size:0;">&nbsp;</div>',
};

/** A new block's HTML. Next to a table row it becomes a row of its own; anywhere else it is just the element. */
export function blockHtml(kind: BlockKind, asRow: boolean): string {
  return asRow ? `<tr><td style="padding:0 24px;">${INNER[kind]}</td></tr>` : INNER[kind];
}
const imageHtml = (url: string, alt: string, asRow: boolean) => {
  const safe = (s: string) => s.replace(/["<>&]/g, "");
  const img = `<img src="${safe(url)}" alt="${safe(alt)}" width="560" style="display:block;max-width:100%;height:auto;border:0;">`;
  return asRow ? `<tr><td style="padding:0 24px;">${img}</td></tr>` : img;
};

const hasShell = (code: string) => /<html[\s>]/i.test(code);

function parse(code: string): Document {
  return new DOMParser().parseFromString(hasShell(code) || /<body[\s>]/i.test(code) ? code : `<!DOCTYPE html><html><body>${code}</body></html>`, "text/html");
}
function numbered(doc: Document): Element[] {
  return Array.from(doc.body.querySelectorAll("*"));
}
function serialize(doc: Document, code: string): string {
  if (!hasShell(code)) return doc.body.innerHTML;
  const dt = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : "";
  return dt + doc.documentElement.outerHTML;
}

const place = (ref: Element | null, node: Node, pos: Pos, body: HTMLElement) => {
  if (!ref) return void body.appendChild(node);
  if (pos === "inside") ref.appendChild(node);
  else if (pos === "before") ref.parentNode?.insertBefore(node, ref);
  else ref.parentNode?.insertBefore(node, ref.nextSibling);
};
const isRowRef = (ref: Element | null, pos: Pos) => !!ref && pos !== "inside" && ref.tagName === "TR";

/** Applies one drag to the HTML. Returns the new HTML, or null if the move makes no sense (so nothing changes). */
export function applyEdit(code: string, edit: DragEdit): string | null {
  const doc = parse(code);
  const els = numbered(doc);
  const at = (i: number | null) => (i === null ? null : els[i] ?? null);

  if (edit.type === "remove") {
    const el = at(edit.id);
    if (!el) return null;
    el.remove();
  } else if (edit.type === "appendTag") {
    const NOTEXT = "table,tr,p,div,h1,h2,h3,h4,h5,h6,ul,ol,li,hr,blockquote";
    let target: Element | null = null;
    for (let i = els.length - 1; i >= 0; i--) {
      const el = els[i];
      // A link is skipped (the tag would become part of the link); its surrounding text takes it instead.
      if (!/^(P|H[1-6]|LI|TD|TH|DIV|BLOCKQUOTE|SPAN)$/.test(el.tagName) || el.querySelector(NOTEXT) || !(el.textContent ?? "").trim()) continue;
      target = el;
      break;
    }
    if (target) target.appendChild(doc.createTextNode(`${/\s$/.test(target.textContent ?? "") ? "" : " "}${edit.tag}`));
    else {
      const p = doc.createElement("p");
      p.textContent = edit.tag;
      doc.body.appendChild(p);
    }
  } else if (edit.type === "text") {
    const el = at(edit.id);
    if (!el) return null;
    el.innerHTML = cleanEmailHtml(edit.html);
  } else if (edit.type === "duplicate") {
    const el = at(edit.id);
    if (!el) return null;
    el.parentNode?.insertBefore(el.cloneNode(true), el.nextSibling);
  } else if (edit.type === "move") {
    const el = at(edit.id);
    const ref = at(edit.target);
    if (!el || (edit.target !== null && !ref)) return null;
    if (ref && (ref === el || el.contains(ref))) return null; // can't drop something into itself
    place(ref, el, edit.pos, doc.body);
  } else {
    const ref = at(edit.target);
    if (edit.target !== null && !ref) return null;
    const asRow = isRowRef(ref, edit.pos);
    const html = edit.type === "insert" ? blockHtml(edit.kind, asRow) : imageHtml(edit.url, edit.alt, asRow);
    const holder = doc.createElement(asRow ? "table" : "div");
    holder.innerHTML = html;
    const nodes = asRow ? Array.from(holder.querySelectorAll("tr")) : Array.from(holder.childNodes);
    let anchor: Element | null = ref;
    let pos = edit.pos;
    for (const n of nodes) {
      place(anchor, n, pos, doc.body);
      anchor = n as Element;
      pos = "after";
    }
  }
  const out = serialize(doc, code);
  return out === code ? null : out;
}

/** The HTML shown in the preview: numbered, free of scripts, optionally with sample names, plus the drag script. */
export function buildPreviewDoc(code: string, opts: { filled: boolean; scrollY: number; interactive: boolean }): string {
  const doc = parse(cleanEmailHtml(code));
  numbered(doc).forEach((el, i) => el.setAttribute("data-plx-id", String(i)));
  if (opts.filled) fillPreview(doc);
  const html = hasShell(code) ? (doc.doctype ? "<!DOCTYPE html>\n" : "") + doc.documentElement.outerHTML : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0">${doc.body.innerHTML}</body></html>`;
  if (!opts.interactive) return html;
  const tail = `<style>${PREVIEW_CSS}</style><script>window.__PLX_SCROLL=${Math.max(0, Math.round(opts.scrollY)) || 0};${PREVIEW_SCRIPT}</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => `${tail}</body>`) : html + tail;
}

/**
 * Shows sample names. In text each tag becomes a marked span (data-plx-tag) so that, after someone edits the words in the
 * preview, the editor can turn "Ada" back into {{first_name}}. In attributes (links, pictures) the value is simply filled.
 */
function fillPreview(doc: Document) {
  const sample = sampleValues();
  const walker = doc.createTreeWalker(doc.body, 4 /* NodeFilter.SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const parent = t.parentElement?.tagName;
    if (parent === "STYLE" || parent === "SCRIPT" || !/\{\{/.test(t.data)) continue;
    const frag = doc.createDocumentFragment();
    let last = 0;
    for (const m of t.data.matchAll(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g)) {
      const v = sample[m[1]];
      if (v === undefined) continue;
      frag.appendChild(doc.createTextNode(t.data.slice(last, m.index)));
      const span = doc.createElement("span");
      span.setAttribute("data-plx-tag", m[1]);
      span.textContent = v;
      frag.appendChild(span);
      last = (m.index ?? 0) + m[0].length;
    }
    frag.appendChild(doc.createTextNode(t.data.slice(last)));
    t.parentNode?.replaceChild(frag, t);
  }
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    for (const a of Array.from(el.attributes)) if (a.value.includes("{{")) el.setAttribute(a.name, fillMergeTags(a.value, sample));
  }
}

const PREVIEW_CSS = `
[data-plx-hover]{outline:2px dashed #7c6cf0 !important;outline-offset:-2px;cursor:grab}
[data-plx-drag]{opacity:.4}
[data-plx-editing]{outline:2px solid #7c6cf0 !important;outline-offset:2px;cursor:text;background-color:rgba(124,108,240,.08)}
[data-plx-tag]{background:rgba(124,108,240,.14);border-radius:3px}
#plx-bar{position:fixed;z-index:2147483647;display:none;gap:2px;padding:3px;background:#1f2430;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.3);font:600 12px system-ui,sans-serif}
#plx-bar button{all:unset;cursor:pointer;color:#fff;padding:4px 8px;border-radius:6px;font:600 12px system-ui,sans-serif;white-space:nowrap}
#plx-bar button:hover,#plx-bar button:focus-visible{background:#3b4254}
#plx-bar [data-grab]{cursor:grab}
#plx-ghost{position:fixed;z-index:2147483647;display:none;pointer-events:none;background:#b8f34a;color:#0b0b12;font:600 12px system-ui,sans-serif;padding:4px 10px;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.35)}
#plx-line{position:fixed;z-index:2147483646;height:3px;background:#7c6cf0;border-radius:2px;pointer-events:none;display:none}
#plx-box{position:fixed;z-index:2147483646;border:2px solid #7c6cf0;background:rgba(124,108,240,.12);pointer-events:none;display:none}
`;

/** Runs inside the sandboxed preview (no access to Plexo). It only ever sends small messages up to the editor. */
const PREVIEW_SCRIPT = `
(function(){
var BLOCK="tr,p,h1,h2,h3,h4,h5,h6,img,hr,ul,ol,blockquote,table,div,a";
var post=function(m){parent.postMessage(Object.assign({plx:1},m),"*")};
var bar=document.createElement("div");bar.id="plx-bar";
bar.innerHTML='<button data-grab title="Drag to move" style="touch-action:none">&#10303; Move</button><button data-up title="Select the section around it">Section</button><button data-dup title="Copy">Copy</button><button data-del title="Delete">Delete</button>';
var line=document.createElement("div");line.id="plx-line";var box=document.createElement("div");box.id="plx-box";
document.body.appendChild(bar);document.body.appendChild(line);document.body.appendChild(box);
var cur=null,dragId=null,dropTo=null,overBar=false,editing=null,before="";
var NOTEXT="table,tr,p,div,h1,h2,h3,h4,h5,h6,ul,ol,li,hr,blockquote";
function editable(t){while(t&&t!==document.body){if(t.hasAttribute&&t.hasAttribute("data-plx-id")&&/^(P|H[1-6]|LI|A|TD|TH|DIV|BLOCKQUOTE|SPAN)$/.test(t.tagName)&&!t.querySelector(NOTEXT)&&t.textContent.trim())return t;t=t.parentNode}return null}
function clean(el){var c=el.cloneNode(true);
  c.querySelectorAll("[data-plx-tag]").forEach(function(s){s.replaceWith(document.createTextNode("{{"+s.getAttribute("data-plx-tag")+"}}"))});
  [c].concat([].slice.call(c.querySelectorAll("*"))).forEach(function(n){[].slice.call(n.attributes).forEach(function(a){if(a.name.indexOf("data-plx")===0||(n===c&&(a.name==="contenteditable")))n.removeAttribute(a.name)})});
  return c.innerHTML}
function finish(save){if(!editing)return;var el=editing;editing=null;post({editing:false});el.removeAttribute("contenteditable");el.removeAttribute("data-plx-editing");
  var html=clean(el);if(save&&html!==before)post({edit:{type:"text",id:idOf(el),html:html}})}
document.addEventListener("dblclick",function(e){var el=editable(e.target);if(!el||bar.contains(e.target))return;finish(true);show(null);
  editing=el;el.setAttribute("contenteditable","true");el.setAttribute("data-plx-editing","");before=clean(el);el.focus();post({editing:true});
  var sel=getSelection(),r=document.createRange();r.selectNodeContents(el);sel.removeAllRanges();sel.addRange(r)});
document.addEventListener("focusout",function(e){if(editing&&e.target===editing)finish(true)});
document.addEventListener("keydown",function(e){if(!editing)return;if(e.key==="Escape"){editing.innerHTML=before;finish(false)}else if(e.key==="Enter"&&!e.shiftKey&&!/^(P|DIV|BLOCKQUOTE|LI|TD|TH)$/.test(editing.tagName)){e.preventDefault();editing.blur()}});
function idOf(el){return el&&el.getAttribute?Number(el.getAttribute("data-plx-id")):null}
function blockOf(t){while(t&&t!==document.body){if(t.matches&&t.matches(BLOCK)&&t.hasAttribute("data-plx-id"))return t;t=t.parentNode}return null}
function show(el){
  if(cur&&cur!==el)cur.removeAttribute("data-plx-hover");
  cur=el;if(!el){bar.style.display="none";return}
  el.setAttribute("data-plx-hover","");
  var r=el.getBoundingClientRect();
  bar.style.display="flex";bar.style.left=Math.max(4,Math.min(r.right-236,innerWidth-244))+"px";bar.style.top=Math.max(4,r.top-34)+"px";
}
var switchT=0,hideT=0;
/* The bar sits just above its block, so reaching it means crossing other blocks. Switching waits a moment, and entering the bar cancels it. */
document.addEventListener("mouseover",function(e){
  if(dragId!==null||editing)return;
  if(bar.contains(e.target)){overBar=true;clearTimeout(switchT);clearTimeout(hideT);return}
  overBar=false;clearTimeout(hideT);
  var b=blockOf(e.target);
  if(b===cur){clearTimeout(switchT);return}
  clearTimeout(switchT);
  if(!cur){show(b);return}
  switchT=setTimeout(function(){if(!overBar)show(b)},260);
});
document.addEventListener("mouseleave",function(){clearTimeout(switchT);hideT=setTimeout(function(){if(!overBar&&dragId===null)show(null)},500)});
bar.addEventListener("mouseenter",function(){overBar=true;clearTimeout(switchT);clearTimeout(hideT)});
bar.addEventListener("mouseleave",function(){overBar=false});
var lastRange=null;
document.addEventListener("selectionchange",function(){if(!editing)return;var s=getSelection();if(s&&s.rangeCount&&editing.contains(s.anchorNode))lastRange=s.getRangeAt(0).cloneRange()});
addEventListener("message",function(e){
  var m=e.data;if(!m||e.source!==parent)return;
  if(m.plx==="insertTag"){
    if(!editing)return;
    editing.focus();var s=getSelection();
    /* The caret is wherever it is now; only if it has left the text (focus moved away) is the last known spot put back. */
    if((!s.rangeCount||!editing.contains(s.anchorNode))&&lastRange){s.removeAllRanges();s.addRange(lastRange)}
    document.execCommand("insertText",false,m.text);
  }else if(m.plx==="dragStart"){
    carry={kind:m.kind,label:m.label||""};
  }else if(m.plx==="dragMove"||m.plx==="dragDrop"){
    /* A block from the strip above is being carried over this page (coordinates arrive in the strip's own scale). */
    if(carry===null)return;
    if(!m.inside){if(m.plx==="dragMove")mark(null);else endCarry();return}
    var sc=m.w?innerWidth/m.w:1,pt={clientX:m.x*sc,clientY:m.y*sc};
    if(m.plx==="dragMove"){show(null);dropTo=spot(pt);mark(dropTo)}
    else{var sp=spot(pt),k=carry.kind;endCarry();if(sp)post({edit:{type:"insert",kind:k,target:sp.el?idOf(sp.el):null,pos:sp.pos}})}
  }
});
/* The strip normally keeps reporting the mouse. If the browser hands the mouse to this page instead, this page finishes the drop itself. Whichever sees the drop first wins; the other finds nothing left to do. */
var carry=null,ghostEl=document.createElement("div");ghostEl.id="plx-ghost";document.body.appendChild(ghostEl);
function endCarry(){carry=null;ghostEl.style.display="none";mark(null);dropTo=null}
document.addEventListener("pointermove",function(e){
  if(carry===null)return;
  if(e.buttons===0){endCarry();return}
  show(null);dropTo=spot(e);mark(dropTo);
  ghostEl.textContent=carry.label;ghostEl.style.display="block";ghostEl.style.left=(e.clientX+12)+"px";ghostEl.style.top=(e.clientY+12)+"px";
});
document.addEventListener("pointerup",function(e){
  if(carry===null)return;
  var k=carry.kind,sp=spot(e);endCarry();
  if(sp)post({edit:{type:"insert",kind:k,target:sp.el?idOf(sp.el):null,pos:sp.pos}});
});
document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest("a");if(a)e.preventDefault()},true);
bar.addEventListener("click",function(e){
  var b=e.target.closest("button");if(!b||!cur)return;
  if(b.hasAttribute("data-del")){post({edit:{type:"remove",id:idOf(cur)}});show(null)}
  else if(b.hasAttribute("data-dup")){post({edit:{type:"duplicate",id:idOf(cur)}})}
  else if(b.hasAttribute("data-up")){var p=blockOf(cur.parentNode);if(p)show(p)}
});
/* Moving a block follows the mouse itself instead of the browser's drag-and-drop, which doesn't reliably cross into this sandboxed page. */
var grab=bar.querySelector("[data-grab]");
grab.addEventListener("pointerdown",function(e){
  if(!cur||e.button!==0)return;e.preventDefault();
  dragId=idOf(cur);cur.setAttribute("data-plx-drag","");
  document.documentElement.style.cursor="grabbing";
  bar.style.pointerEvents="none";try{grab.setPointerCapture(e.pointerId)}catch(_){}
});
grab.addEventListener("pointermove",function(e){if(dragId===null)return;dropTo=spot(e);mark(dropTo)});
grab.addEventListener("pointerup",function(e){
  if(dragId===null)return;
  var id=dragId,s=spot(e);reset();
  if(s&&s.el)post({edit:{type:"move",id:id,target:idOf(s.el),pos:s.pos}});
});
grab.addEventListener("pointercancel",function(){reset()});
function spot(e){
  var moving=dragId!==null?document.querySelector('[data-plx-id="'+dragId+'"]'):null;
  var t=document.elementFromPoint(e.clientX,e.clientY);
  var el=blockOf(t);
  if(moving&&el&&(el===moving||moving.contains(el)))return null;
  if(moving&&moving.tagName==="TR"){while(el&&el.tagName!=="TR")el=blockOf(el.parentNode)}
  else if(el&&el.tagName==="TR"){var rr=el.getBoundingClientRect(),f=(e.clientY-rr.top)/Math.max(1,rr.height);if(f<.28)return{el:el,pos:"before"};if(f>.72)return{el:el,pos:"after"};var inner=t&&t.closest&&t.closest("td,th");if(inner)return{el:inner,pos:"inside"}}
  if(!el){return{el:null,pos:"inside"}}
  var r=el.getBoundingClientRect();
  return{el:el,pos:e.clientY<r.top+r.height/2?"before":"after"};
}
function mark(s){
  if(!s||!s.el){line.style.display="none";box.style.display="none";return}
  var r=s.el.getBoundingClientRect();
  if(s.pos==="inside"){line.style.display="none";box.style.display="block";box.style.left=r.left+"px";box.style.top=r.top+"px";box.style.width=r.width+"px";box.style.height=r.height+"px"}
  else{box.style.display="none";line.style.display="block";line.style.left=r.left+"px";line.style.width=r.width+"px";line.style.top=(s.pos==="before"?r.top-1:r.bottom-1)+"px"}
}
document.addEventListener("dragover",function(e){e.preventDefault();dropTo=spot(e);mark(dropTo)});
function reset(){dragId=null;dropTo=null;mark(null);document.documentElement.style.cursor="";bar.style.pointerEvents="";var d=document.querySelector("[data-plx-drag]");if(d)d.removeAttribute("data-plx-drag")}
document.addEventListener("dragend",reset);
document.addEventListener("drop",function(e){
  e.preventDefault();var s=dropTo||spot(e);var t=s&&s.el?idOf(s.el):null,pos=s?s.pos:"inside";
  var text=e.dataTransfer.getData("text/plain")||"";
  if(text.indexOf("plx-move:")===0){post({edit:{type:"move",id:Number(text.slice(9)),target:t,pos:pos}})}
  else if(text.indexOf("plx-block:")===0){post({edit:{type:"insert",kind:text.slice(10),target:t,pos:pos}})}
  else if(e.dataTransfer.files&&e.dataTransfer.files[0]){post({file:e.dataTransfer.files[0],target:t,pos:pos})}
  reset();
});
var st=0;addEventListener("scroll",function(){clearTimeout(st);st=setTimeout(function(){post({scroll:scrollY})},120);if(cur)show(cur)},{passive:true});
addEventListener("load",function(){scrollTo(0,window.__PLX_SCROLL||0)});
scrollTo(0,window.__PLX_SCROLL||0);
})();
`;
