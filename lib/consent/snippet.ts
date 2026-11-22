import type { ConsentSettings } from "./model";

/**
 * The one script Plexo adds to a published page for Google Analytics. It is self-contained (no extra request), so it
 * works the same on builder pages, uploaded HTML and React apps.
 *
 * Visitors who need consent (lib/consent/regions.ts): Google Consent Mode v2 starts as "denied", Google's tag is NOT
 * loaded, and a small notice is shown. Accept loads the tag and tells Google analytics_storage is granted. The choice
 * lives in a first-party cookie (plexo_consent, 180 days), and a "Change cookie settings" button lets people change it.
 * Everyone else: the tag loads straight away and there is no notice.
 *
 * The notice sits in a shadow root (the site's own CSS cannot break it, and it cannot break the site's), is fixed to the
 * screen (no layout shift), and never blocks the page: no overlay, no scroll lock, no focus trap.
 */

export const CONSENT_COOKIE = "plexo_consent";

export type TagOptions = {
  measurementId: string;
  /** This visitor must be asked first. */
  required: boolean;
  settings: ConsentSettings;
};

/** Black or white, whichever reads better on the colour. */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? "#111111" : "#ffffff";
}

// JSON inside a <script>: "<" must never appear raw.
const json = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const RUNTIME = `(function(C){
var w=window,d=document;w.dataLayer=w.dataLayer||[];
if(!w.gtag)w.gtag=function(){w.dataLayer.push(arguments)};
var loaded=false;
function load(){if(loaded)return;loaded=true;w.gtag("js",new Date());
if(!d.querySelector('script[src*="googletagmanager.com/gtag/js"]')){var s=d.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(C.id);d.head.appendChild(s)}
w.gtag("config",C.id)}
if(!C.ask){load();return}
w.gtag("consent","default",{ad_storage:"denied",ad_user_data:"denied",ad_personalization:"denied",analytics_storage:"denied"});
function read(){var m=d.cookie.match(/(?:^|; )plexo_consent=(granted|denied)/);return m?m[1]:null}
function write(v){d.cookie="plexo_consent="+v+"; Max-Age=15552000; Path=/; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"")}
function forget(){d.cookie.split("; ").forEach(function(c){var n=c.split("=")[0];if(n.indexOf("_ga")===0){var h=location.hostname.split("."),i;for(i=0;i<h.length-1;i++){d.cookie=n+"=; Max-Age=0; Path=/; Domain="+h.slice(i).join(".")}d.cookie=n+"=; Max-Age=0; Path=/"}})}
function grant(){w.gtag("consent","update",{analytics_storage:"granted"});load()}
function deny(){w.gtag("consent","update",{analytics_storage:"denied"});forget()}
var first=read();if(first==="granted")grant();
var host,root,box,pill,off=function(){var b=d.querySelector("[data-plexo-badge]");return b?b.offsetHeight:0};
function css(){var a=C.accent?C.accent:"var(--color-action-primary,#1f2937)",t=C.accent?C.onAccent:"var(--color-action-primary-text,#ffffff)";
return ":host{all:initial}*{box-sizing:border-box}.b{position:fixed;z-index:2147483000;font:15px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--color-text-primary,#1a1a1a);background:var(--color-bg-canvas,#fff);border:1px solid rgba(127,127,127,.35);box-shadow:0 8px 30px rgba(0,0,0,.18);padding:14px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;bottom:calc(var(--off,0px) + 12px)}"
+".bar{left:12px;right:12px;border-radius:12px;justify-content:space-between}.card{left:12px;max-width:360px;border-radius:14px;flex-direction:column;align-items:stretch}"
+".m{margin:0;flex:1 1 260px}.a{display:flex;gap:8px;flex:0 0 auto}.card .a{width:100%}button{font:inherit;font-weight:600;cursor:pointer;border-radius:10px;padding:9px 16px;min-height:40px;border:2px solid "+a+";flex:1 1 auto}"
+".y{background:"+a+";color:"+t+"}.n{background:transparent;color:var(--color-text-primary,#1a1a1a)}button:focus-visible{outline:3px solid var(--color-focus-ring,#2563eb);outline-offset:2px}"
+".p{position:fixed;left:12px;z-index:2147483000;bottom:calc(var(--off,0px) + 8px);font:12px/1 system-ui,sans-serif;padding:7px 10px;min-height:0;border-radius:999px;border:1px solid rgba(127,127,127,.4);background:var(--color-bg-canvas,#fff);color:var(--color-text-primary,#1a1a1a);opacity:.85}"
+"@media (prefers-color-scheme:dark){.b,.p{background:var(--color-bg-canvas,#16181d);color:var(--color-text-primary,#f2f2f2)}.n{color:var(--color-text-primary,#f2f2f2)}}"
+"@media (prefers-reduced-motion:no-preference){.b{animation:f .2s ease-out}@keyframes f{from{opacity:0}to{opacity:1}}}"}
function mount(){if(host)return;host=d.createElement("div");host.setAttribute("data-plexo-consent","");root=host.attachShadow({mode:"open"});
var st=d.createElement("style");st.textContent=css();root.appendChild(st);d.body.appendChild(host);host.style.setProperty("--off",off()+"px")}
function el(tag,cls,txt){var e=d.createElement(tag);if(cls)e.className=cls;if(txt)e.textContent=txt;return e}
function clear(){["b","p"].forEach(function(c){var e=root&&root.querySelector("."+c);if(e)e.remove()});box=pill=null}
function choose(v){write(v);if(v==="granted")grant();else deny();clear();showPill()}
function showBox(){mount();clear();host.style.setProperty("--off",off()+"px");
box=el("div","b "+C.pos);box.setAttribute("role","region");box.setAttribute("aria-label",C.aria);
box.appendChild(el("p","m",C.msg));var a=el("div","a"),n=el("button","n",C.no),y=el("button","y",C.yes);n.type=y.type="button";
n.onclick=function(){choose("denied")};y.onclick=function(){choose("granted")};a.appendChild(n);a.appendChild(y);box.appendChild(a);root.appendChild(box)}
function showPill(){mount();clear();host.style.setProperty("--off",off()+"px");pill=el("button","p",C.change);pill.type="button";pill.onclick=showBox;root.appendChild(pill)}
function ready(f){if(d.body)f();else d.addEventListener("DOMContentLoaded",f)}
ready(function(){
if(read()===null)showBox();else showPill();
d.addEventListener("click",function(e){var t=e.target&&e.target.closest&&e.target.closest("[data-plexo-cookie-settings],a[href='#cookie-settings']");if(t){e.preventDefault();showBox()}})});
})`;

/** The script tag to put in the page's <head>. Written with the settings baked in; nothing here comes from the visitor. */
export function analyticsSnippet(opts: TagOptions): string {
  const s = opts.settings;
  const ask = opts.required && s.enabled;
  const config = {
    id: opts.measurementId,
    ask,
    msg: s.message,
    yes: s.acceptLabel,
    no: s.declineLabel,
    pos: s.position,
    accent: s.accentColor,
    onAccent: s.accentColor ? readableOn(s.accentColor) : null,
    aria: "Cookie notice",
    change: "Change cookie settings",
  };
  return `<script data-plexo-analytics>${RUNTIME}(${json(config)});</script>`;
}
