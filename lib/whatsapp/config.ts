// WhatsApp Business Cloud API settings. Every value comes from SSM via lib/ssmEnv.ts (and so from
// GitHub Environment secrets on deploy): to go from Meta's free test number to the verified one,
// change these secrets in GitHub and redeploy — no code change.
//
//   WHATSAPP_ACCESS_TOKEN     permanent System User token (Meta Business Settings)
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's id (WhatsApp → API Setup)
//   WHATSAPP_APP_SECRET       the Meta app's secret — signs every webhook call
//   WHATSAPP_VERIFY_TOKEN     any string; the same one is typed into Meta's webhook form
//   WHATSAPP_BUSINESS_NUMBER  the public number people message, e.g. 2348012345678 (for wa.me links)
//   WHATSAPP_GRAPH_VERSION    optional, e.g. v21.0

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  /** Digits only (no "+"): what a wa.me link needs. */
  businessNumber: string;
  graphVersion: string;
}

/** Null until every value is set, so the feature simply stays off (and the dashboard says so)
 * on an environment that hasn't been connected to Meta yet. */
export function getWhatsAppConfig(): WhatsAppConfig | null {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  const businessNumber = (process.env.WHATSAPP_BUSINESS_NUMBER ?? "").replace(/\D/g, "");
  if (!accessToken || !phoneNumberId || !appSecret || !verifyToken || !businessNumber) return null;
  return { accessToken, phoneNumberId, appSecret, verifyToken, businessNumber, graphVersion: process.env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0" };
}

/** The dashboard's own origin, for "Connect your account here" links inside chat replies. */
export function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

export const SOL_SETTINGS_PATH = "/dashboard/sol/settings";
