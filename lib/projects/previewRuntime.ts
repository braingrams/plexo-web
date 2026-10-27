// Small scripts injected into a project's index.html at serve time (lib/projects/serve.ts).
// Written as plain ES2017 strings — they run inside the owner's app, so they must not depend
// on anything and must never throw.

/** Live sites and previews: page views for client-side route changes (an SPA only loads
 * one HTML page, so the server alone would count one view per visit). */
export const ANALYTICS_BEACON_JS = `(function(){try{
var last=null;function send(){var p=location.pathname;if(p===last)return;last=p;
var body=JSON.stringify({path:p,referrer:document.referrer||null});
if(navigator.sendBeacon){navigator.sendBeacon('/__plexo/api/_analytics/pageview',new Blob([body],{type:'application/json'}))}
else{fetch('/__plexo/api/_analytics/pageview',{method:'POST',body:body,headers:{'content-type':'application/json'},keepalive:true}).catch(function(){})}}
var ps=history.pushState,rs=history.replaceState;
history.pushState=function(){var r=ps.apply(this,arguments);setTimeout(send,0);return r};
history.replaceState=function(){var r=rs.apply(this,arguments);setTimeout(send,0);return r};
addEventListener('popstate',send);
if(document.readyState==='complete')send();else addEventListener('load',send);
}catch(e){}})();`;

/**
 * Preview hosts only — the bridge between the app (inside the editor's iframe) and the
 * Plexo editor around it:
 * - Errors: uncaught errors, unhandled rejections, console.error, and failed backend calls
 *   are posted to the editor (error banner + "Fix with AI") and to the app's runtime-error
 *   log (so SOL sees them even when no editor is open).
 * - Select & Edit: when the editor turns inspect mode on, hovering outlines the nearest
 *   element carrying data-plexo-loc (added to preview builds only) and clicking sends its
 *   source location, text and classes to the editor instead of activating it.
 * - Routes: reports the current path so the editor's address bar follows the app, and
 *   navigates when the editor asks.
 * Messages are only accepted from, and only sent to, the dashboard's own origin.
 */
export function previewRuntimeJs(editorOrigin: string): string {
  return `(function(){try{
var EDITOR=${JSON.stringify(editorOrigin)};var inFrame=window.parent!==window;
function post(m){if(inFrame){try{window.parent.postMessage(Object.assign({source:'plexo-preview'},m),EDITOR)}catch(e){}}}
var seen={},count=0;
function report(kind,message,stack){message=String(message||'Unknown error').slice(0,2000);var key=kind+message;
if(seen[key]||count>50)return;seen[key]=1;count++;
var e={kind:kind,message:message,stack:stack?String(stack).slice(0,6000):null,url:location.pathname,at:Date.now()};
post({type:'plexo:error',error:e});
try{fetch('/__plexo/api/_runtime/errors',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(e),keepalive:true}).catch(function(){})}catch(x){}}
addEventListener('error',function(ev){if(ev.error||ev.message)report('error',ev.message,ev.error&&ev.error.stack)});
addEventListener('unhandledrejection',function(ev){var r=ev.reason;report('unhandledrejection',r&&r.message||r,r&&r.stack)});
var ce=console.error;console.error=function(){try{var a=[].slice.call(arguments);var err=a.find(function(x){return x instanceof Error});
var msg=a.map(function(x){return x instanceof Error?x.message:typeof x==='string'?x:(function(){try{return JSON.stringify(x)}catch(e){return String(x)}})()}).join(' ');
if(!/^Warning:|Download the React DevTools/.test(msg))report('console',msg,err&&err.stack)}catch(e){}return ce.apply(console,arguments)};
var f=window.fetch;window.fetch=function(input,init){var url=typeof input==='string'?input:(input&&input.url)||'';
return f.apply(this,arguments).then(function(res){if(res.status>=500&&url.indexOf('/__plexo/api/')!==-1&&url.indexOf('/_runtime/')===-1){
res.clone().json().then(function(j){report('backend',(j&&j.error&&j.error.message)||('Backend request failed ('+res.status+')'),url)}).catch(function(){report('backend','Backend request failed ('+res.status+')',url)})}return res})};
var lastPath=null;function nav(){var p=location.pathname+location.search;if(p!==lastPath){lastPath=p;post({type:'plexo:navigate',path:p,title:document.title})}}
setInterval(nav,400);addEventListener('popstate',nav);
var inspect=false,box=null,label=null,hovered=null;
function target(el){while(el&&el.nodeType===1){if(el.hasAttribute&&el.hasAttribute('data-plexo-loc'))return el;el=el.parentElement}return null}
function ensureBox(){if(box)return;box=document.createElement('div');box.style.cssText='position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #7c3aed;background:rgba(124,58,237,.08);border-radius:4px;transition:all .06s';
label=document.createElement('div');label.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;background:#7c3aed;color:#fff;font:600 11px/1.6 system-ui,sans-serif;padding:0 6px;border-radius:4px;white-space:nowrap';
document.documentElement.appendChild(box);document.documentElement.appendChild(label)}
function show(el){ensureBox();var r=el.getBoundingClientRect();box.style.display=label.style.display='block';
box.style.left=r.left+'px';box.style.top=r.top+'px';box.style.width=r.width+'px';box.style.height=r.height+'px';
label.textContent=el.tagName.toLowerCase()+' · '+(el.getAttribute('data-plexo-loc')||'').split(':')[0].split('/').pop();
label.style.left=Math.max(0,r.left)+'px';label.style.top=Math.max(0,r.top-20)+'px'}
function hide(){if(box){box.style.display=label.style.display='none'}hovered=null}
function describe(el){var r=el.getBoundingClientRect();var loc=(el.getAttribute('data-plexo-loc')||'').split(':');
return{file:loc[0],line:Number(loc[1])||null,column:Number(loc[2])||null,tag:el.tagName.toLowerCase(),
text:(el.innerText||'').trim().slice(0,300),classes:(el.getAttribute('class')||'').slice(0,500),
rect:{x:r.left,y:r.top,width:r.width,height:r.height},path:location.pathname}}
addEventListener('mousemove',function(ev){if(!inspect)return;var el=target(ev.target);if(el!==hovered){hovered=el;el?show(el):hide()}},true);
addEventListener('click',function(ev){if(!inspect)return;ev.preventDefault();ev.stopPropagation();var el=target(ev.target);if(el)post({type:'plexo:selected',element:describe(el)})},true);
addEventListener('scroll',function(){if(inspect&&hovered)show(hovered)},true);
addEventListener('message',function(ev){if(ev.origin!==EDITOR||!ev.data||ev.data.target!=='plexo-preview')return;var d=ev.data;
if(d.type==='plexo:inspect'){inspect=!!d.enabled;document.documentElement.style.cursor=inspect?'crosshair':'';if(!inspect)hide()}
else if(d.type==='plexo:navigate-to'&&typeof d.path==='string'&&d.path.charAt(0)==='/'){history.pushState({},'',d.path);dispatchEvent(new PopStateEvent('popstate'))}
else if(d.type==='plexo:reload'){location.reload()}});
post({type:'plexo:ready',path:location.pathname+location.search});
}catch(e){}})();`;
}
