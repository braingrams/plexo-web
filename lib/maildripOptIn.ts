// Real MailDrip API calls (create + publish an opt-in page), backing the form_container
// 'maildrip' provider's "Create MailDrip Opt-in Page" action. Deliberately does NOT fall
// back to the platform's own shared MAILDRIP_API_KEY the way lib/commerce/maildripNotify.ts
// does for transactional receipts — a page created under Plexo's own MailDrip account would
// be invisible in the site owner's own MailDrip dashboard, defeating the point of "sign in to
// your own MailDrip account first." This always requires the site's own
// CommerceSettings.maildripApiKeyEncrypted.

const MAILDRIP_API_BASE = "https://api.maildrip.io/api/v1";
export const MAILDRIP_SIGNUP_URL = "https://app.maildrip.io/signup";
export const MAILDRIP_API_KEYS_SETTINGS_URL = "https://app.maildrip.io/settings/api-keys";

function maildripEditUrl(pageId: string): string {
  return `https://app.maildrip.io/opt-in-forms/${pageId}/edit-opt-in-form`;
}

export type CreateOptInPageResult = { pageId: string; editUrl: string };

/**
 * Creates a MailDrip opt-in page (title only — MailDrip's own createOptInPage sets up a
 * paired campaign + contact group automatically) and immediately publishes it with a single
 * email-capture field, since MailDrip's own embed-config endpoint 404s an unpublished page —
 * the <opt-in-embed-form> would render nothing at all until this second call.
 */
export async function createAndPublishMaildripOptInPage(apiKey: string, title: string): Promise<CreateOptInPageResult> {
  const createRes = await fetch(`${MAILDRIP_API_BASE}/opt-in-pages`, {
    method: "POST",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    throw new Error(createRes.status === 401 ? "MailDrip rejected this API key." : `Could not create the MailDrip opt-in page (${createRes.status}): ${body.slice(0, 300)}`);
  }
  // MailDrip's sendData() helper always wraps as {success:true, data:{...}}.
  const created = (await createRes.json()) as { data?: { pageId?: string } };
  const pageId = created.data?.pageId;
  if (!pageId) {
    throw new Error("MailDrip did not return a page id.");
  }

  const publishRes = await fetch(`${MAILDRIP_API_BASE}/opt-in-pages/${pageId}/publish`, {
    method: "PUT",
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ form_fields: [{ name: "email", type: "email" }] }),
  });
  if (!publishRes.ok) {
    const body = await publishRes.text().catch(() => "");
    throw new Error(`Created the page but could not publish it (${publishRes.status}): ${body.slice(0, 300)}`);
  }

  return { pageId, editUrl: maildripEditUrl(pageId) };
}
