import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import type { PaymentItem } from "./payments";

// The Plexo-branded receipt/invoice PDF, drawn from a Payment row — no Stripe call, so it
// is identical every time it's downloaded. Standard PDF fonts only (WinAnsi), so any text
// that comes from a customer is stripped of characters those fonts can't draw.

const VIOLET = rgb(0.545, 0.361, 0.965);
const INK = rgb(0.059, 0.09, 0.165);
const MUTED = rgb(0.392, 0.455, 0.545);
const LINE = rgb(0.886, 0.91, 0.941);

const CARD_BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex", discover: "Discover", jcb: "JCB", diners: "Diners", unionpay: "UnionPay" };

/** Replace anything the built-in fonts can't encode, so a name like "Ọlá" never breaks the download. */
function safe(text: string, font: PDFFont): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      try {
        font.encodeText(base);
        out += base;
      } catch {
        out += "?";
      }
    }
  }
  return out;
}

function money(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${currency.toUpperCase()} ${(cents / 100).toFixed(2)}`;
  }
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" });

export async function buildReceiptPdf(payment: PaymentItem, customer: { name: string | null; email: string | null }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Plexo receipt ${payment.receiptNumber ?? ""}`.trim());
  pdf.setProducer("Plexo");
  pdf.setCreator("Plexo");
  const page = pdf.addPage([595, 842]); // A4
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const M = 56;

  const text = (t: string, x: number, y: number, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10;
    const s = safe(t, font);
    page.drawText(s, { x: opts.right ? x - font.widthOfTextAtSize(s, size) : x, y, size, font, color: opts.color ?? INK });
  };
  const rule = (y: number) => page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.75, color: LINE });

  // Header — logo mark + wordmark, and the document title on the right.
  const logoY = height - M - 28;
  // Rounded square (drawn as a path — drawRectangle has no corner radius).
  page.drawSvgPath("M7 0h14a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H7a7 7 0 0 1-7-7V7a7 7 0 0 1 7-7z", { x: M, y: logoY + 28, color: VIOLET });
  page.drawSvgPath("M12 2L4 7v5c0 4.97 3.35 9.63 8 10.93C17.65 21.63 21 16.97 21 12V7L12 2z", { x: M + 6, y: logoY + 22, scale: 0.67, color: rgb(1, 1, 1) });
  text("Plexo", M + 38, logoY + 8, { size: 18, font: bold });
  text("RECEIPT", width - M, logoY + 14, { size: 20, font: bold, color: VIOLET, right: true });
  text(payment.receiptNumber ?? "", width - M, logoY, { size: 10, color: MUTED, right: true });

  // Meta block.
  let y = logoY - 56;
  const label = (t: string, x: number, yy: number) => text(t.toUpperCase(), x, yy, { size: 7.5, font: bold, color: MUTED });
  label("Billed to", M, y);
  text(customer.name || customer.email || "Plexo customer", M, y - 15, { size: 11, font: bold });
  if (customer.name && customer.email) text(customer.email, M, y - 29, { color: MUTED });

  const col = width - M - 170;
  label("Date paid", col, y);
  text(longDate(payment.paidAt), col, y - 15, { size: 11, font: bold });
  label("Payment method", col, y - 40);
  const card = payment.cardLast4 ? `${CARD_BRANDS[payment.cardBrand ?? ""] ?? payment.cardBrand ?? "Card"} ending ${payment.cardLast4}` : "Card";
  text(card, col, y - 55, { size: 11, font: bold });

  // Line item.
  y -= 100;
  page.drawRectangle({ x: M, y: y - 8, width: width - 2 * M, height: 26, color: rgb(0.973, 0.98, 0.988) });
  label("Description", M + 10, y);
  text("AMOUNT", width - M - 10, y, { size: 7.5, font: bold, color: MUTED, right: true });
  y -= 30;
  text(payment.description, M + 10, y, { size: 11, font: bold });
  text(money(payment.amountCents, payment.currency), width - M - 10, y, { size: 11, right: true });
  if (payment.detail) {
    y -= 15;
    text(payment.detail, M + 10, y, { color: MUTED });
  }
  y -= 22;
  rule(y);

  // Totals.
  const totalRow = (k: string, v: string, strong = false) => {
    y -= 22;
    text(k, width - M - 190, y, { size: strong ? 12 : 10, font: strong ? bold : regular, color: strong ? INK : MUTED });
    text(v, width - M - 10, y, { size: strong ? 12 : 10, font: strong ? bold : regular, right: true });
  };
  totalRow("Subtotal", money(payment.amountCents, payment.currency));
  if ((payment.refundedCents ?? 0) > 0) totalRow("Refunded", `-${money(payment.refundedCents ?? 0, payment.currency)}`);
  y -= 8;
  page.drawLine({ start: { x: width - M - 190, y: y - 6 }, end: { x: width - M, y: y - 6 }, thickness: 0.75, color: LINE });
  totalRow("Total paid", money(payment.amountCents - (payment.refundedCents ?? 0), payment.currency), true);

  // Footer.
  const fy = M + 40;
  rule(fy + 24);
  text("Thank you for building with Plexo.", M, fy, { size: 10, font: bold });
  text("Questions about this receipt? Reply to the email it came with, or contact support from your Plexo dashboard.", M, fy - 14, { color: MUTED, size: 9 });
  text(`Payment reference ${payment.id}`, M, fy - 28, { color: MUTED, size: 8 });

  return pdf.save();
}
