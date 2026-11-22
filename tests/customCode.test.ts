import { describe, expect, it } from "vitest";
import { sanitizeCustomCode, MAX_CUSTOM_CODE_CHARS } from "@/lib/customCode/sanitize";
import { customCodeBlock, customCodeEditError, customCodeRunsOnServe } from "@/lib/customCode/gate";
import { injectCustomCode } from "@/lib/pub/htmlInject";

const ok = (s: string) => {
  const r = sanitizeCustomCode(s);
  if (!r.ok) throw new Error(r.error);
  return r.html;
};
const bad = (s: string) => {
  const r = sanitizeCustomCode(s);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.error;
};

describe("sanitizeCustomCode: what is accepted", () => {
  it("treats empty input as clearing the code", () => {
    expect(ok("")).toBe("");
    expect(ok("   \n ")).toBe("");
    expect(sanitizeCustomCode(null)).toEqual({ ok: true, html: "" });
  });
  it("accepts a Google verification meta tag", () => {
    expect(ok('<meta name="google-site-verification" content="abc123" />')).toBe('<meta name="google-site-verification" content="abc123">');
  });
  it("accepts a Google tag script pair", () => {
    const code = `<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>\n<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());</script>`;
    const out = ok(code);
    expect(out).toContain('src="https://www.googletagmanager.com/gtag/js?id=G-1"');
    expect(out).toContain("function gtag()");
  });
  it("accepts a pixel with a noscript image", () => {
    const out = ok('<noscript><img height="1" width="1" style="display:none" src="https://www.facebook.com/tr?id=1&ev=PageView&noscript=1"/></noscript>');
    expect(out).toContain("<noscript><img");
    expect(out).toContain("&amp;ev=PageView");
  });
  it("accepts GTM noscript iframe, link and style", () => {
    expect(ok('<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-X" height="0" width="0"></iframe></noscript>')).toContain("<iframe");
    expect(ok('<link rel="preconnect" href="https://fonts.gstatic.com">')).toContain("preconnect");
    expect(ok("<style>body{color:red}</style>")).toBe("<style>body{color:red}</style>");
  });
  it("drops comments", () => {
    expect(ok("<!-- note --><meta name='a' content='b'>")).toBe('<meta name="a" content="b">');
  });
  it("re-escapes attribute values it writes back out", () => {
    expect(ok(`<meta name='x' content='a"b<c>'>`)).toBe('<meta name="x" content="a&quot;b&lt;c&gt;">');
  });
});

describe("sanitizeCustomCode: what is rejected", () => {
  it("rejects tags outside the allow-list", () => {
    expect(bad("<div>hi</div>")).toMatch(/can't be added/);
    expect(bad("<iframe src='https://a.com'></iframe>")).toMatch(/can't be added/);
    expect(bad("<img src=x>")).toMatch(/can't be added/);
    expect(bad("<noscript><script>alert(1)</script></noscript>")).toMatch(/isn't allowed inside/);
  });
  it("rejects stray text", () => {
    expect(bad("hello <meta name=a content=b>")).toMatch(/text here/);
    expect(bad("<noscript>hi</noscript>")).toMatch(/Plain text/);
  });
  it("rejects unclosed or unparseable snippets", () => {
    expect(bad("<script>var a=1;")).toMatch(/isn't closed/);
    expect(bad("<meta name='a")).toMatch(/quote/);
    expect(bad("<meta name=a")).toMatch(/isn't finished/);
    expect(bad("<noscript><img src='https://a.com/x.gif'>")).toMatch(/isn't closed/);
    expect(bad("<<")).toBeTruthy();
  });
  it("rejects scripts that could close the snippet or the page early", () => {
    expect(bad("<script>/*<!--*/</script>")).toMatch(/<!--/);
    expect(bad("<style>a{}</style></style>")).toBeTruthy();
  });
  it("rejects event handlers and dangerous addresses", () => {
    expect(bad('<link rel="x" href="https://a.com" onload="alert(1)">')).toMatch(/Event attributes/);
    expect(bad('<link rel="x" href="javascript:alert(1)">')).toMatch(/isn't allowed/);
    expect(bad('<link rel="x" href="java\nscript:alert(1)">')).toMatch(/isn't allowed/);
    expect(bad('<script src="data:text/javascript,alert(1)"></script>')).toMatch(/isn't allowed/);
    expect(bad('<script src="/local.js"></script>')).toMatch(/full https/);
    expect(bad('<noscript><iframe srcdoc="<b>x</b>" src="https://a.com"></iframe></noscript>')).toMatch(/srcdoc/);
  });
  it("enforces size and tag-count limits", () => {
    expect(bad("<script>" + "a".repeat(MAX_CUSTOM_CODE_CHARS) + "</script>")).toMatch(/too long/);
    expect(bad("<meta name=a content=b>".repeat(30))).toMatch(/lot of tags/);
    expect(sanitizeCustomCode(42).ok).toBe(false);
  });
});

describe("customCode gate: plan x custom domain", () => {
  const plans = ["FREE", "STARTER", "PRO", "ENTERPRISE", null, undefined, "SOMETHING_ELSE"] as const;
  const allowed = new Set(["STARTER", "PRO", "ENTERPRISE"]);

  for (const plan of plans) {
    for (const hasCustomDomain of [true, false]) {
      const ok = allowed.has(plan as string) && hasCustomDomain;
      it(`${String(plan)} ${hasCustomDomain ? "with" : "without"} a custom domain ${ok ? "can" : "cannot"} add code`, () => {
        expect(customCodeEditError({ plan, hasCustomDomain }) === null).toBe(ok);
        const block = customCodeBlock({ plan, hasCustomDomain });
        if (ok) return expect(block).toBeNull();
        // Plan is checked first; each block says what to do and offers one place to do it.
        expect(block?.reason).toBe(allowed.has(plan as string) ? "domain" : "plan");
        expect(block?.fix.href).toMatch(/^\/dashboard\//);
        expect(block?.message).not.toMatch(/Pro plan|API|DNS record|JSON/i);
      });
    }
  }
  it("tells Free to upgrade to Starter and Starter without a domain to connect one", () => {
    expect(customCodeEditError({ plan: "FREE", hasCustomDomain: true })).toMatch(/Starter plan and above/);
    expect(customCodeEditError({ plan: "STARTER", hasCustomDomain: false })).toMatch(/connect one first/);
    expect(customCodeBlock({ plan: "STARTER", hasCustomDomain: false })?.fix.label).toBe("Connect my domain");
  });
  it("runs on serve for Starter and above, on a custom domain only", () => {
    for (const plan of ["STARTER", "PRO", "ENTERPRISE"]) {
      expect(customCodeRunsOnServe({ plan, servedOnCustomDomain: true })).toBe(true);
      expect(customCodeRunsOnServe({ plan, servedOnCustomDomain: false })).toBe(false);
    }
    expect(customCodeRunsOnServe({ plan: "FREE", servedOnCustomDomain: true })).toBe(false);
    expect(customCodeRunsOnServe({ plan: null, servedOnCustomDomain: true })).toBe(false);
  });
});
