import { describe, expect, it } from "vitest";
import { detectPageCaptcha, transformPage } from "@/lib/wpMigration/htmlTransform";

const ctx = { origin: "https://charisol.io", pageUrl: "https://charisol.io/payment/", pagePath: "/payment/", pageTitle: "Payment", siteTemplateId: "site1", movedLinks: {}, appUrl: "https://plexo.charisol.io" };

// charisol.io/payment/ — the real Forminator + Stripe form, as WordPress serves it.
const PAYMENT_FORM = `<form
				id="forminator-module-6742"
				class="forminator-ui forminator-custom-form forminator-custom-form-6742 forminator-design--default  forminator_ajax"
				method="post"
				data-forminator-render="1"
				data-form-id="6742"
				 data-color-option="default" data-design="default" data-grid="open" style="display: none;"
				data-uid="6afea6e88bb4c"
			><div role="alert" aria-live="polite" class="forminator-response-message forminator-error" aria-hidden="true"></div><div class="forminator-row"><div id="email-1" class="forminator-field-email forminator-col forminator-col-12 "><div class="forminator-field"><label for="forminator-field-email-1_6afea6e88bb4c" id="forminator-field-email-1_6afea6e88bb4c-label" class="forminator-label">Email Address</label><input type="email" name="email-1" value="" placeholder="timothy.ofili@charisol.io" id="forminator-field-email-1_6afea6e88bb4c" class="forminator-input forminator-email--field" data-required="" aria-required="false" autocomplete="email" /></div></div></div><div class="forminator-row"><div id="stripe-ocs-1" class="forminator-field-stripe-ocs forminator-col forminator-col-12 "><div class="forminator-field"><label for="stripe-ocs-1-field" id="stripe-ocs-1-field-label" class="forminator-label">Card Details <span class="forminator-required">*</span></label><div id="payment-element-6afea6e88bb4c" data-field-id="6afea6e88bb4c" data-is-payment="true" data-payment-type="stripe" data-is-ocs="1" data-secret="" data-paymentid="" data-currency="usd" data-key="pk_live_51Kt77BDdgt0vAbTGxu4JeN6sEKVHpqLOtu1AfArhSSzKbIloDG5styjahzWm8SxfjU4eUBgRhElPoJIipM1vC0wC00k71SetKb" data-receipt="1" data-receipt-email="email-1" data-billing="" data-billing-name="" data-billing-email="" data-billing-phone="" data-billing-address="" data-return-url="https://stripe.com" class="forminator-stripe-element forminator-stripe-payment-element"></div><input type="hidden" name="paymentid" value="" id="forminator-stripe-paymentid"/><input type="hidden" name="paymentmethod" value="" id="forminator-stripe-paymentmethod"/><input type="hidden" name="subscriptionid" value="" id="forminator-stripe-subscriptionid"/><span class="forminator-card-message"><span class="forminator-error-message" aria-hidden="true"></span></span></div></div></div><div class="forminator-row"><div id="name-1" class="forminator-field-name forminator-col forminator-col-12 "><div class="forminator-field"><label for="forminator-field-name-1_6afea6e88bb4c" id="forminator-field-name-1_6afea6e88bb4c-label" class="forminator-label">Card Holder</label><input type="text" name="name-1" value="" placeholder="Timothy Charisol" id="forminator-field-name-1_6afea6e88bb4c" class="forminator-input forminator-name--field" aria-required="false" autocomplete="name" /></div></div></div><div class="forminator-row"><div id="currency-1" class="forminator-field-currency forminator-col forminator-col-12 "><div class="forminator-field"><label for="forminator-field-currency-1_6afea6e88bb4c" id="forminator-field-currency-1_6afea6e88bb4c-label" class="forminator-label">Amount ($)</label><div class="forminator-input-with-suffix"><input name="currency-1" value="" placeholder="1,500.00" id="forminator-field-currency-1_6afea6e88bb4c" class="forminator-input forminator-currency" data-required="" aria-required="" data-decimals="2" data-inputmask="&#039;groupSeparator&#039;: &#039;&#039;, &#039;radixPoint&#039;: &#039;.&#039;, &#039;digits&#039;: &#039;2&#039;" type="number" step="any" /><span class="forminator-suffix">USD</span></div></div></div></div><input type="hidden" name="referer_url" value="" /><div class="forminator-row forminator-row-last"><div class="forminator-col"><div class="forminator-field"><button class="forminator-button forminator-button-submit pay-now-btn">MAKE PAYMENT</button></div></div></div><input type="hidden" id="forminator_nonce" name="forminator_nonce" value="76141a1c23" /><input type="hidden" name="_wp_http_referer" value="/payment/" /><input type="hidden" name="form_id" value="6742"><input type="hidden" name="page_id" value="14156"><input type="hidden" name="form_type" value="default"><input type="hidden" name="current_url" value="https://charisol.io/payment/"><input type="hidden" name="render_id" value="1"><input type="hidden" name="action" value="forminator_submit_form_custom-forms"></form>`;
const paymentPage = `<html><head><title>Payment</title>
<script src="https://js.stripe.com/v3/"></script>
<script src="https://charisol.io/wp-content/plugins/forminator/build/front/front.multi.min.js"></script>
</head><body><h2>Make a payment</h2>${PAYMENT_FORM}</body></html>`;

describe("charisol.io/payment/ — a Forminator Stripe form", () => {
  const result = transformPage(paymentPage, ctx);

  it("becomes a Plexo payment, not a contact form that charges nothing", () => {
    expect(result.donationForms).toHaveLength(1);
    expect(result.forms).toEqual([]);
    expect(result.unmigratedForms).toEqual([]);
    expect(result.html).toMatch(/data-plexo-donation="__PLEXO_DONATION__forminator-payment:6742__"/);
    expect(result.html).not.toContain("/api/public/forms/");
  });

  it("keeps the amount open-ended and in USD, with the payer's email and name wired up", () => {
    const form = result.donationForms[0];
    expect(form.allowCustomAmount).toBe(true);
    expect(form.presets).toEqual([]);
    expect(form.allowMonthly).toBe(false);
    expect(form.currency).toBe("USD");
    expect(result.html).toMatch(/name="currency-1"[^>]*data-plexo-custom-amount|data-plexo-custom-amount[^>]*name="currency-1"/);
    expect(result.html).toMatch(/type="email"[^>]*data-plexo-donor-email|data-plexo-donor-email[^>]*type="email"/);
    expect(result.html).toContain("data-plexo-donor-name");
    expect(result.html).toContain("MAKE PAYMENT");
  });

  it("removes Stripe's card field, WordPress plumbing and the plugins' scripts", () => {
    expect(result.html).not.toContain("payment-element");
    expect(result.html).not.toContain("pk_live_");
    expect(result.html).not.toContain("js.stripe.com");
    expect(result.html).not.toContain("forminator_nonce");
    expect(result.html).not.toContain("front.multi.min.js");
    expect(result.html).not.toMatch(/forminator_ajax|display:\s*none/);
  });
});

describe("a Forminator PayPal form (can't be moved automatically)", () => {
  const html = `<html><body><form class="forminator-custom-form" data-form-id="9"><div class="forminator-field-paypal"><div id="pp"></div></div><button>Pay</button></form></body></html>`;
  const result = transformPage(html, ctx);
  it("is reported as an unconverted payment form so the domain switch is blocked", () => {
    expect(result.unmigratedForms.length).toBeGreaterThan(0);
    expect(result.donationForms).toEqual([]);
  });
});

describe("Cloudflare Turnstile from a WordPress plugin", () => {
  const html = `<html><head><title>Home</title>
<script>var KitgenixCaptchaForCloudflareTurnstileConfig={"site_key":"0x4AAAAAADcYRIowzCZgtAXn","mode":"auto"};</script>
<script type="text/rocketlazyloadscript" data-rocket-src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"></script>
<script type="text/rocketlazyloadscript" data-rocket-src="/wp-content/cache/min/1/wp-content/plugins/kitgenix-captcha-for-cloudflare-turnstile/assets/js/public.js"></script>
<script>window.TurnstileElementorConfig={"site_key":"0x4AAAAAADcYRIowzCZgtAXn"};</script>
<script type="application/ld+json">{"@type":"WebSite"}</script>
</head><body><form class="elementor-form" method="post" name="Contact"><input type="hidden" name="form_id" value="a1"/><label for="e">Email</label><input type="email" id="e" name="form_fields[email]"/><button type="submit">Send</button></form></body></html>`;
  const result = transformPage(html, ctx);

  it("removes the scripts that show \"Verification failed\" on the new address", () => {
    expect(result.html).not.toContain("challenges.cloudflare.com");
    expect(result.html).not.toContain("kitgenix");
    expect(result.html).not.toContain("TurnstileElementorConfig");
    expect(result.html).toContain("application/ld+json");
  });

  it("remembers the provider and public site key on each form, so the owner's keys can be kept", () => {
    expect(result.forms[0].captcha).toEqual({ provider: "turnstile", siteKey: "0x4AAAAAADcYRIowzCZgtAXn" });
    expect(result.html).not.toContain("0x4AAAAAADcYRIowzCZgtAXn");
  });

  it("reads keys from widget markup for reCAPTCHA and hCaptcha too", () => {
    expect(detectPageCaptcha(`<div class="g-recaptcha" data-sitekey="6Ldpg34eAAAAAJtPg3__B816Axq2E3INH5vAP69Y"></div>`)).toEqual({ provider: "recaptcha", siteKey: "6Ldpg34eAAAAAJtPg3__B816Axq2E3INH5vAP69Y" });
    expect(detectPageCaptcha(`<div data-sitekey="10000000-ffff-ffff-ffff-000000000001" class="h-captcha"></div>`)).toEqual({ provider: "hcaptcha", siteKey: "10000000-ffff-ffff-ffff-000000000001" });
    expect(detectPageCaptcha("<p>no captcha</p>")).toBeNull();
  });
});
