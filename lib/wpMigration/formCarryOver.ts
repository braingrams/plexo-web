// What a WordPress form did after each submission (as the Plexo Migrator plugin reports it —
// /form-actions), turned into what its Plexo form does (FormSettings): the same webhook in
// the same format, the same thank-you page, the same mailing list when it's MailDrip — and,
// for anything Plexo can't repeat, a plain note for the owner saying what to do.

export interface ExportedFormActions {
  plugin: "elementor";
  /** Elementor's element id — the hidden form_id the migrated form remembers as sourceKey. */
  id: string;
  post_id: number;
  name: string;
  actions: string[];
  webhook: string;
  webhook_advanced: boolean;
  email_to: string;
  redirect_to: string;
  /** Mailing-list integrations' chosen list ids, keyed by Elementor's setting name ("mailchimp_list"). */
  lists: Record<string, string>;
}

export interface CarriedOverForm {
  webhookUrl?: string;
  webhookFormat?: "form" | "json";
  /** Where visitors go after submitting — a path on the site, or a full address. */
  redirectUrl?: string;
  /** The MailDrip list it added people to (the owner confirms it once MailDrip is connected). */
  maildripGroupId?: string;
  notes: string[];
}

const LIST_PROVIDERS: Record<string, string> = {
  mailchimp: "Mailchimp",
  activecampaign: "ActiveCampaign",
  getresponse: "GetResponse",
  convertkit: "ConvertKit (Kit)",
  mailerlite: "MailerLite",
  drip: "Drip",
  mailpoet: "MailPoet",
  sendinblue: "Brevo",
  brevo: "Brevo",
  klaviyo: "Klaviyo",
  hubspot: "HubSpot",
  moosend: "Moosend",
  sendy: "Sendy",
};

/** Actions that need nothing from Plexo: it stores every submission and emails the owner already. */
const ALREADY_COVERED = new Set(["email", "collect_submissions", "save_to_database"]);
const NOT_NEEDED = new Set(["activity-log", "popup"]);

function sameSite(url: string, origin: string): string {
  try {
    const target = new URL(url, origin);
    const site = new URL(origin);
    if (target.hostname.replace(/^www\./, "") === site.hostname.replace(/^www\./, "")) return `${target.pathname}${target.search}${target.hash}`;
    return target.toString();
  } catch {
    return url;
  }
}

export function carryOverForm(form: ExportedFormActions, origin: string): CarriedOverForm {
  const out: CarriedOverForm = { notes: [] };
  const actions = form.actions.map((a) => a.toLowerCase());

  for (const action of actions) {
    if (ALREADY_COVERED.has(action) || NOT_NEEDED.has(action)) continue;
    if (action === "webhook") {
      if (/^https:\/\//i.test(form.webhook)) {
        out.webhookUrl = form.webhook;
        // Elementor's simple webhook posts the fields form-encoded under their labels; with
        // "advanced data" on it posts a JSON-ish structure — keep what the receiver expects.
        out.webhookFormat = form.webhook_advanced ? "json" : "form";
      } else if (form.webhook) {
        out.notes.push(`On WordPress this form sent each submission to ${form.webhook}, which isn't a secure (https) address — add an https webhook here to keep that going.`);
      }
      continue;
    }
    if (action === "redirect") {
      if (form.redirect_to) out.redirectUrl = sameSite(form.redirect_to, origin);
      continue;
    }
    if (action === "email2") {
      out.notes.push("On WordPress this form also emailed the person who filled it in. Plexo doesn't send that confirmation email yet — the thank-you message on the page still shows.");
      continue;
    }
    const provider = Object.keys(LIST_PROVIDERS).find((p) => action === p || action.startsWith(`${p}`));
    if (action === "maildrip" || action.startsWith("maildrip")) {
      const listId = Object.entries(form.lists).find(([k]) => k.toLowerCase().startsWith("maildrip"))?.[1];
      if (listId) out.maildripGroupId = listId;
      else out.notes.push("On WordPress this form added people to MailDrip — pick the list here to keep that going.");
      continue;
    }
    if (provider) {
      const listId = Object.entries(form.lists).find(([k]) => k.toLowerCase().startsWith(provider))?.[1];
      out.notes.push(
        `On WordPress this form added people to ${LIST_PROVIDERS[provider]}${listId ? ` (list ${listId})` : ""}. Plexo can add them to a MailDrip list, or send them to ${LIST_PROVIDERS[provider]} through a webhook (for example with Zapier) — set it up here.`,
      );
      continue;
    }
    out.notes.push(`On WordPress this form also ran "${action}" after each submission, which Plexo doesn't do — check whether you still need it.`);
  }
  return out;
}
