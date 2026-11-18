import { describe, expect, it } from "vitest";
import { cleanEmailHtml, editorMergeTags, emailHtmlWarnings, fillMergeTags, findMergeTags, missingMergeTags, sampleValues } from "@/lib/email/mergeTags";

describe("email merge tags", () => {
  const html = '<p>Hi {{first_name}}, {{ first_name }} again. <a href="{{unsubscribe_url}}">Stop</a> {{coupon}}</p>';

  it("lists each tag once, in order, and says which the sender fills", () => {
    expect(findMergeTags(html)).toEqual([
      { key: "first_name", known: true },
      { key: "unsubscribe_url", known: true },
      { key: "coupon", known: false },
    ]);
  });

  it("fills known values, escapes them and leaves unknown tags alone", () => {
    const out = fillMergeTags(html, { first_name: 'Ada <b>"', unsubscribe_url: "https://x.test/u" });
    expect(out).toContain("Hi Ada &lt;b&gt;&quot;, Ada &lt;b&gt;&quot; again.");
    expect(out).toContain('href="https://x.test/u"');
    expect(out).toContain("{{coupon}}");
    expect(missingMergeTags(html, { first_name: "A", unsubscribe_url: "u" })).toEqual(["coupon"]);
  });

  it("offers exactly the five agreed tags, with sample values", () => {
    expect(editorMergeTags().map((t) => t.value)).toEqual(["{{first_name}}", "{{last_name}}", "{{email}}", "{{unsubscribe_url}}", "{{view_in_browser_url}}"]);
    expect(Object.keys(sampleValues())).toHaveLength(5);
  });

  it("strips scripts, handlers and javascript links but keeps the design", () => {
    const dirty = '<table style="width:100%"><tr><td onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">go</a><iframe src="//e"></iframe></td></tr></table>';
    const clean = cleanEmailHtml(dirty);
    expect(clean).not.toMatch(/script|onclick|javascript:|iframe/i);
    expect(clean).toContain('<table style="width:100%">');
    expect(clean).toContain("Hi");
  });

  it("warns, in plain words, about things email apps drop", () => {
    expect(emailHtmlWarnings('<div style="display:flex"><img src="logo.png"></div>')).toHaveLength(2);
    expect(emailHtmlWarnings('<table><tr><td><img src="https://x.test/a.gif"></td></tr></table>')).toEqual([]);
  });
});
