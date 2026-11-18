import { User } from "@/lib/db/coreEntities";
import { syncPhoneToAlps } from "@/lib/alps";
import { normalizePhone } from "./phoneFormat";

/**
 * The phone number on a person's profile. It is saved when they connect WhatsApp to SOL, because that number is confirmed
 * (the message came from it), and is there for support. Disconnecting WhatsApp does NOT remove it: it stays on the profile.
 */

/**
 * Saves a confirmed number on the profile and passes it to Alps (the CRM). Never throws: connecting WhatsApp must not fail because
 * of this, so a problem is logged and the connection carries on.
 */
export async function savePhoneToProfile(userId: string, rawPhone: string): Promise<void> {
  try {
    const phone = normalizePhone(rawPhone);
    if (!phone) return;
    const { data: user } = await User.get({ id: userId }).go();
    if (!user || user.phone === phone) return;
    await User.patch({ id: userId }).set({ phone, phoneSavedAt: new Date().toISOString() }).go();
    syncPhoneToAlps({ id: userId, email: user.email, name: user.name ?? null, image: user.image ?? null }, phone);
  } catch (err) {
    console.error("[profile] couldn't save the phone number:", err instanceof Error ? err.message : err);
  }
}
