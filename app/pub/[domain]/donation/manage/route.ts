import { NextResponse } from "next/server";
import { resolveSite } from "@/lib/pub/resolveSiteDynamo";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * /donation/manage?token=… on the organization's own domain — where the "Manage your
 * monthly gift" link in a donor's receipt lands. Deliberately tiny and self-contained: it
 * reads the gift via /api/public/commerce/donations/manage and offers one action, stopping
 * it. No account or password for the donor; the private token in their email is the key.
 */
export async function GET(_request: Request, context: { params: Promise<{ domain: string }> }): Promise<NextResponse> {
  const { domain } = await context.params;
  const site = await resolveSite(decodeURIComponent(domain));
  if (site.status !== "ok") return new NextResponse("Not found", { status: 404 });
  const siteName = escapeHtml(site.published.template.name || "our organization");

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Your monthly gift — ${siteName}</title>
<style>
:root{color-scheme:light}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f6f7f9;color:#0f172a;display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
.card{background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(15,23,42,.08);padding:32px;max-width:440px;width:100%;text-align:center}
h1{font-size:20px;margin:0 0 6px}p{color:#475569;line-height:1.6;margin:0 0 18px;font-size:15px}.amt{font-size:30px;font-weight:800;color:#0f172a;margin:6px 0 4px}
button{font:inherit;font-weight:650;border:1px solid #e2e8f0;background:#fff;color:#b91c1c;padding:12px 20px;border-radius:10px;cursor:pointer}button[disabled]{opacity:.6;cursor:default}
.muted{font-size:13px;color:#94a3b8}.ok{color:#15803d;font-weight:600}
</style></head><body><main class="card" id="app"><p>Loading your gift…</p></main>
<script>
(function(){
  var app=document.getElementById("app");var token=new URLSearchParams(location.search).get("token")||"";
  function money(m,c){try{return new Intl.NumberFormat(undefined,{style:"currency",currency:c}).format(m/100)}catch(e){return c+" "+(m/100).toFixed(2)}}
  function esc(s){var d=document.createElement("div");d.textContent=s||"";return d.innerHTML}
  fetch("/api/public/commerce/donations/manage?token="+encodeURIComponent(token)).then(function(r){return r.json().then(function(b){return{ok:r.ok,b:b}})}).then(function(res){
    if(!res.ok){app.innerHTML="<h1>Link not valid</h1><p>"+esc(res.b.error||"This link isn't valid any more.")+"</p>";return}
    var g=res.b.gift;var active=g.status==="ACTIVE"||g.status==="PAST_DUE"||g.status==="PENDING";
    app.innerHTML="<h1>Your monthly gift to ${siteName}</h1>"+(g.campaignName?"<p class=muted>"+esc(g.campaignName)+"</p>":"")+
      "<div class=amt>"+money(g.amountMinor,g.currency)+"<span class=muted> / month</span></div>"+
      (active?"<p>Thank you for giving every month. If you need to stop, you can do it here — no questions asked.</p><button id=stop>Stop my monthly gift</button>":"<p class=ok>Your monthly gift has been stopped. Thank you for your support.</p>");
    var b=document.getElementById("stop");if(!b)return;
    b.onclick=function(){if(!confirm("Stop your monthly gift? You won't be charged again."))return;b.disabled=true;b.textContent="Stopping…";
      fetch("/api/public/commerce/donations/manage",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:token})}).then(function(r){return r.json().then(function(x){return{ok:r.ok,x:x}})}).then(function(res){
        if(res.ok){app.innerHTML="<h1>Your monthly gift has been stopped</h1><p>You won't be charged again. Thank you for everything you've given.</p>"}
        else{b.disabled=false;b.textContent="Stop my monthly gift";alert(res.x.error||"Something went wrong — please try again.")}
      })}
  }).catch(function(){app.innerHTML="<p>We couldn't load your gift — please try again.</p>"});
})();
</script></body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
