import { describe, expect, it } from "vitest";

import { analyzeCustomCode, sanitizeCustomCode } from "@/lib/customCode/sanitize";

const rejects = (s: string) => {
  const r = sanitizeCustomCode(s);
  expect(r.ok, `should be rejected: ${s}`).toBe(false);
};
const accepts = (s: string) => {
  const r = sanitizeCustomCode(s);
  if (!r.ok) throw new Error(`should be accepted: ${s}\n${r.error}`);
  return r.html;
};

describe("sanitiser: known bypass attempts are rejected", () => {
  const cases: Record<string, string> = {
    "tag not on the list": "<div>hi</div>",
    "uppercase disallowed tag": "<DIV>hi</DIV>",
    "iframe at the top level": '<iframe src="https://x.com"></iframe>',
    "svg with script": "<svg onload=alert(1)></svg>",
    "svg wrapped in noscript": "<noscript><svg onload=alert(1)></svg></noscript>",
    "base tag": '<base href="https://evil.example/">',
    "base inside noscript": '<noscript><base href="https://evil.example/"></noscript>',
    "form": '<form action="https://evil.example"></form>',
    "object": "<object data=x></object>",
    "embed": "<embed src=x>",
    "meta refresh": '<meta http-equiv="refresh" content="0;url=https://evil.example">',
    "meta refresh uppercase": '<META HTTP-EQUIV="Refresh" CONTENT="0;url=//evil.example">',
    "meta refresh with entity-padded value": '<meta http-equiv=" refresh " content="0;url=//e.co">',
    "meta set-cookie": '<meta http-equiv="set-cookie" content="a=b">',
    "meta csp": '<meta http-equiv="Content-Security-Policy" content="default-src none">',
    "meta charset": '<meta charset="utf-7">',
    "event handler on noscript img": '<noscript><img src="https://x.com/a.png" onerror="alert(1)"></noscript>',
    "event handler uppercase": '<noscript><img src="https://x.com/a.png" ONERROR="alert(1)"></noscript>',
    "event handler on link": '<link rel="stylesheet" href="https://x.com/a.css" onload="alert(1)">',
    "event handler on meta": "<meta name=a content=b onmouseover=alert(1)>",
    "javascript: href": '<link rel="x" href="javascript:alert(1)">',
    "javascript: with tab": '<link rel="x" href="java\tscript:alert(1)">',
    "javascript: with newline": '<link rel="x" href="java\nscript:alert(1)">',
    "javascript: leading control chars": '<link rel="x" href="\u0001javascript:alert(1)">',
    "data: script src": '<script src="data:text/javascript,alert(1)"></script>',
    "blob: script src": '<script src="blob:https://x.com/1"></script>',
    "relative script src": '<script src="/evil.js"></script>',
    "insecure http script src": '<script src="http://x.com/a.js"></script>',
    "srcdoc on iframe": '<noscript><iframe src="https://x.com" srcdoc="<script>1</script>"></iframe></noscript>',
    "iframe with javascript src": '<noscript><iframe src="javascript:alert(1)"></iframe></noscript>',
    "script ended early with </script/>": "<script>a()</script/><img src=x onerror=alert(1)></script>",
    "script ended early with </script x>": "<script>a()</script x><b>x</b></script>",
    "script with html comment opener": "<script><!--\nalert(1)</script>",
    "unterminated script": "<script>alert(1)",
    "unterminated style": "<style>a{}",
    "unterminated noscript": '<noscript><img src="https://x.com/a.png">',
    "unterminated tag": '<meta name="a" content="b"',
    "unterminated attribute quote": '<meta name="a content=b>',
    "nested noscript": "<noscript><noscript></noscript></noscript>",
    "script inside noscript": "<noscript><script>alert(1)</script></noscript>",
    "text outside tags": "alert(1)",
    "text after a snippet": "<meta name=a content=b> hello",
    "text inside noscript": "<noscript>hello</noscript>",
    "stray closing tag": "</script>",
    "doctype": "<!DOCTYPE html>",
    "xml processing instruction": '<?xml version="1.0"?>',
    "cdata": "<![CDATA[x]]>",
    "unclosed comment": "<!-- never ends <script>alert(1)</script>",
    "style with a nested style tag": "<style>a{}</style><style>b{}</style></style>",
    "style that closes early with attributes": "<style>a{}</style x><div></div></style>",
    "style javascript url": "<style>a{background:url(javascript:alert(1))}</style>",
    "inline style expression": '<noscript><img src="https://x.com/a.png" style="width:expression(alert(1))"></noscript>',
    "NUL byte": "<meta name=a content=b>\u0000",
    "self-closed script": '<script src="https://x.com/a.js" />',
    "slash instead of space": '<script/src="https://x.com/a.js"></script>',
    "odd attribute name": '<meta na"me=a content=b>',
    "not a string": "",
  };
  for (const [name, src] of Object.entries(cases)) {
    if (name === "not a string") continue;
    it(`rejects: ${name}`, () => rejects(src));
  }
  it("rejects non-text input", () => {
    for (const v of [42, {}, [], true]) expect(sanitizeCustomCode(v).ok).toBe(false);
  });
});

describe("sanitiser: real snippets still work and come out re-written, never copied", () => {
  const real = {
    searchConsole: '<meta name="google-site-verification" content="abc123_DEF-456" />',
    facebookDomain: '<meta name="facebook-domain-verification" content="abcdefghijklmnop" />',
    metaPixel:
      "<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','123456789');fbq('track','PageView');</script>" +
      '<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=123456789&ev=PageView&noscript=1" /></noscript>',
    hotjar: "<script>(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:1234567,hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r);})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');</script>",
    gtag: '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123DEF4"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag("js",new Date());gtag("config","G-ABC123DEF4");</script>',
    gtm: "<noscript><iframe src=\"https://www.googletagmanager.com/ns.html?id=GTM-XXXX\" height=\"0\" width=\"0\" style=\"display:none;visibility:hidden\"></iframe></noscript>",
    fonts: '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">',
    metaViewport: '<meta name="robots" content="index,follow">',
    css: "<style>.badge{color:red}</style>",
  };
  for (const [name, src] of Object.entries(real)) {
    it(`accepts ${name}`, () => {
      const out = accepts(src);
      // Re-writing is stable: saving what we saved changes nothing.
      expect(accepts(out)).toBe(out);
    });
  }
  it("lowercases tag and attribute names and re-escapes values", () => {
    expect(accepts('<META NAME="a" CONTENT=\'x"y\'>')).toBe('<meta name="a" content="x&quot;y">');
  });
  it("does not double-escape entities and does not let entity-hidden schemes through", () => {
    expect(accepts('<meta name="a" content="Tom &amp; Jerry">')).toBe('<meta name="a" content="Tom &amp; Jerry">');
    const out = accepts('<link rel="x" href="https://x.com/?a=1&amp;b=2">');
    expect(out).toContain("a=1&amp;b=2");
    // A hidden scheme stays as inert literal text (the ampersand is escaped again), never a live address.
    const hidden = accepts('<meta name="a" content="java&#115;cript:alert(1)">');
    expect(hidden).toContain("&amp;#115;");
  });
  it("drops comments (even ones holding code)", () => {
    expect(accepts("<!-- <script>alert(1)</script> --><meta name=a content=b>")).toBe('<meta name="a" content="b">');
  });
  it("allows an event attribute on <script> itself (a script already runs code) but nowhere else", () => {
    accepts('<script onload="x()" src="https://x.com/a.js"></script>');
    rejects('<meta onload="x()" name="a" content="b">');
  });
});

describe("sanitiser: per-snippet plain-language results", () => {
  it("names what was pasted", () => {
    const a = analyzeCustomCode('<meta name="google-site-verification" content="x"><meta name="facebook-domain-verification" content="y">');
    expect(a.snippets.map((s) => s.summary)).toEqual(["Google Search Console site verification", "Facebook (Meta) domain verification"]);
  });
  it("recognises the common pixels", () => {
    const names = (src: string) => analyzeCustomCode(src).snippets.map((s) => s.summary);
    expect(names("<script>fbq('init','1')</script>")).toEqual(["Meta (Facebook) pixel"]);
    expect(names("<script>(function(){var s='https://static.hotjar.com/c/hotjar-'})()</script>")).toEqual(["Hotjar"]);
    expect(names('<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>')).toEqual(["Google Analytics"]);
    expect(names('<script src="https://widget.example.org/a.js"></script>')).toEqual(["A script from widget.example.org"]);
  });
  it("points at the snippet that failed and keeps the ones before it", () => {
    const a = analyzeCustomCode('<meta name="a" content="b"><div>no</div>');
    expect(a.ok).toBe(false);
    expect(a.snippets).toHaveLength(2);
    expect(a.snippets[0]).toMatchObject({ ok: true });
    expect(a.snippets[1]).toMatchObject({ ok: false, index: 2 });
    expect(a.snippets[1].error).toMatch(/can't be added/);
  });
  it("every error is written for a non-technical reader", () => {
    const messages = ["<div>", "<script>x", "<meta", "text", "<noscript>hi</noscript>", '<meta http-equiv="refresh" content="1">', "<script><!--</script>"].map((s) => {
      const r = sanitizeCustomCode(s);
      return r.ok ? "" : r.error;
    });
    for (const m of messages) {
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/exception|undefined|regex|stack|\bNaN\b/i);
    }
  });
  it("enforces the size limit with a friendly message", () => {
    const r = sanitizeCustomCode("<style>" + "a".repeat(21_000) + "</style>");
    expect(r.ok ? "" : r.error).toMatch(/too long.*20,000/);
  });
});

// A seeded shuffle of hostile fragments: whatever comes out as "accepted" must be safe and stable.
describe("sanitiser: fuzz", () => {
  const frags = [
    "<script>", "</script>", "</script/>", "<SCRIPT SRC=//x.co/a.js>", "<noscript>", "</noscript>", "<style>", "</style>", "<!--", "-->", "<img src=x onerror=1>",
    "<meta http-equiv=refresh content=0>", "<meta name=a content=b>", "<link href=javascript:1>", "<svg/onload=1>", "<base href=//e.co>", "\"", "'", "<", ">", "=",
    "javascript:", "java\nscript:", "&#106;avascript:", "srcdoc=", " onclick=", "<iframe src=//x.co>", "</iframe>", "<a href=1>", "text", " ", "\n",
  ];
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  it("never throws, and every accepted result is safe and stable", () => {
    let accepted = 0;
    for (let n = 0; n < 4000; n++) {
      const len = 1 + Math.floor(rnd() * 8);
      const src = Array.from({ length: len }, () => frags[Math.floor(rnd() * frags.length)]).join(rnd() < 0.3 ? "" : " ");
      const r = sanitizeCustomCode(src);
      if (!r.ok) continue;
      accepted++;
      const out = r.html;
      // Stable.
      const again = sanitizeCustomCode(out);
      expect(again.ok && again.html).toBe(out);
      // Outside script/style bodies, only the allowed tags exist.
      const markup = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/g, "");
      for (const m of markup.matchAll(/<\/?([a-zA-Z][\w-]*)/g)) {
        expect(["meta", "link", "noscript", "img", "iframe", "style", "script"]).toContain(m[1].toLowerCase());
      }
      expect(markup).not.toMatch(/\son[a-z]+\s*=/i);
      expect(markup).not.toMatch(/http-equiv/i);
      expect(markup).not.toMatch(/\bsrcdoc\b/i);
      expect(markup).not.toMatch(/(href|src)="\s*javascript:/i);
    }
    expect(accepted).toBeGreaterThan(50); // the fuzz exercises the accept path too, not just rejections
  });
  it("survives long and deeply odd input quickly", () => {
    const t = Date.now();
    for (const src of ["<".repeat(20_000), "<script>".repeat(2_000), '<meta name="' + "a".repeat(19_000), "<noscript>".repeat(3_000), "<!--".repeat(5_000)]) {
      sanitizeCustomCode(src);
    }
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe("sanitiser: the dashboard's example placeholders", () => {
  it("refuses an example whose placeholder was never replaced", () => {
    const r = sanitizeCustomCode('<meta name="google-site-verification" content="PASTE-YOUR-CODE-HERE" />');
    expect(r.ok ? "" : r.error).toMatch(/Replace PASTE-YOUR-CODE-HERE/);
  });
});
