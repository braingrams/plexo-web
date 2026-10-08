import { describe, expect, it } from "vitest";
import { transformPage } from "@/lib/wpMigration/htmlTransform";

// maildrip.io's Elementor Pro newsletter form, as WordPress serves it.
const page = `<!DOCTYPE html><html><head><title>MailDrip</title></head><body><h2>Get the strategies</h2>
<form class="elementor-form" method="post" name="Newsletter Form" aria-label="Newsletter Form"> <input type="hidden" name="post_id" value="4271"/> <input type="hidden" name="form_id" value="b48f986"/> <input type="hidden" name="referer_title" value="5 Free Chrome Extensions" /> <input type="hidden" name="queried_id" value="5076"/>
<div class="elementor-form-fields-wrapper elementor-labels-">
<div class="elementor-field-type-email elementor-field-group elementor-column elementor-field-group-email elementor-col-100 elementor-field-required"><label for="form-field-email" class="elementor-field-label elementor-screen-only"> Email </label><input size="1" type="email" name="form_fields[email]" id="form-field-email" class="elementor-field" placeholder="Your email" required="required"></div>
<div class="elementor-field-type-text elementor-field-group elementor-column elementor-field-group-field_00757c3 elementor-col-100 elementor-field-required"><label for="form-field-field_00757c3" class="elementor-field-label elementor-screen-only"> First Name </label><input size="1" type="text" name="form_fields[field_00757c3]" id="form-field-field_00757c3" class="elementor-field" placeholder="First Name" required="required"></div>
<div class="elementor-field-type-recaptcha elementor-field-group elementor-column elementor-field-group-field_2c07c6e elementor-col-100"><div class="elementor-field" id="form-field-field_2c07c6e"><div class="elementor-g-recaptcha" data-sitekey="6Ldpg34eAAAAAJtPg3__B816Axq2E3INH5vAP69Y" data-type="v2_checkbox"></div></div></div>
<div class="elementor-field-group elementor-column elementor-field-type-submit elementor-col-100 e-form__buttons"><button class="elementor-button" type="submit"><span class="elementor-button-text">SEND ME THE STRATEGIES </span></button></div>
</div></form><script src="https://maildrip.io/wp-content/plugins/elementor-pro/assets/js/form.js"></script></body></html>`;

describe("maildrip's Elementor newsletter form", () => {
  const result = transformPage(page, { origin: "https://maildrip.io", pageUrl: "https://maildrip.io/", pagePath: "/", pageTitle: "MailDrip", siteTemplateId: "site1", movedLinks: {}, appUrl: "https://plexo.charisol.io" });

  it("submits to Plexo Forms with its real field names, keeping the look", () => {
    expect(result.forms).toHaveLength(1);
    expect(result.forms[0].fields).toEqual(["Email", "First Name"]);
    expect(result.html).toMatch(/action="\/api\/public\/forms\/site1\/submit\?form=/);
    expect(result.html).toContain("SEND ME THE STRATEGIES");
    expect(result.html).toContain('class="elementor-form"');
  });

  it("drops WordPress's reCAPTCHA (Plexo's honeypot blocks spam instead) and its plumbing fields", () => {
    expect(result.html).not.toContain("g-recaptcha");
    expect(result.html).not.toContain("6Ldpg34eAAAAAJtPg3__B816Axq2E3INH5vAP69Y");
    expect(result.html).not.toMatch(/name="(post_id|form_id|queried_id|referer_title)"/);
    expect(result.html).toContain('name="_hp_field"');
  });
});

describe("maildrip's Elementor login widget (/guest-login/)", () => {
  const page = `<html><head><title>Guest Login</title></head><body><form class="elementor-login elementor-form" method="post" action="https://maildrip.io/dripaxxex/?wpe-login=true" aria-label="Login form"> <input type="hidden" name="redirect_to" value="https://maildrip.io/wp-admin/edit.php"> <div class="elementor-form-fields-wrapper"> <div class="elementor-field-type-text elementor-field-group"> <label for="user-cb2a6d5" class="elementor-field-label">Email Address</label> <input size="1" type="text" name="log" id="user-cb2a6d5"> </div> <div class="elementor-field-type-text elementor-field-group"> <label for="password-cb2a6d5" class="elementor-field-label">Password</label> <input size="1" type="password" name="pwd" id="password-cb2a6d5"> </div> <button type="submit" class="elementor-button" name="wp-submit"><span class="elementor-button-text">Log In</span></button> </div> </form></body></html>`;
  const result = transformPage(page, { origin: "https://maildrip.io", pageUrl: "https://maildrip.io/guest-login/", pagePath: "/guest-login/", pageTitle: "Guest Login", siteTemplateId: "site1", movedLinks: {}, appUrl: "https://plexo.charisol.io" });

  it("is never turned into a form whose answers (a password!) are stored and emailed", () => {
    expect(result.forms).toEqual([]);
    expect(result.html).not.toContain("/api/public/forms/");
    expect(result.loginForms).toBe(1);
  });

  it("sends nothing typed anywhere and points team members to Plexo sign-in", () => {
    expect(result.html).toContain('action="https://plexo.charisol.io/auth/login"');
    expect(result.html).not.toMatch(/name="(log|pwd|redirect_to)"/);
  });
});

describe("migrated forms remember their WordPress form", () => {
  it("Elementor's form id is kept so the plugin's report of what it did can be matched", async () => {
    const { transformPage: t } = await import("@/lib/wpMigration/htmlTransform");
    const r = t(`<html><body><form class="elementor-form" method="post"><input type="hidden" name="form_id" value="b48f986"/><input type="email" name="form_fields[email]"><button>Go</button></form></body></html>`, { origin: "https://maildrip.io", pageUrl: "https://maildrip.io/", pagePath: "/", pageTitle: "MailDrip", siteTemplateId: "site1", movedLinks: {}, appUrl: "https://plexo.charisol.io" });
    expect(r.forms[0].sourceKey).toBe("elementor:b48f986");
  });
});
