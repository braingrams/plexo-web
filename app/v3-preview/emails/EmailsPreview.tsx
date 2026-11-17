"use client";

import { useSearchParams } from "next/navigation";
import { EmailsLibrary } from "@/app/dashboard/_v3/emails/EmailsLibrary";
import type { EmailCard } from "@/lib/dashboardV3/emailsData";

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const mail = (bg: string, accent: string, head: string, line: string) =>
  `<html><body style="margin:0;background:${bg};font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:32px 24px"><div style="font-weight:800;font-size:15px;color:${accent};letter-spacing:.04em">AMA'S KITCHEN</div><h1 style="font-size:30px;line-height:1.15;color:#1a1a1a;margin:28px 0 12px">${head}</h1><p style="font-size:16px;line-height:1.5;color:#555">${line}</p><div style="margin:26px 0"><span style="display:inline-block;background:${accent};color:#fff;padding:14px 26px;border-radius:10px;font-weight:700">Start cooking</span></div><div style="height:140px;border-radius:14px;background:#e9e6df"></div><p style="font-size:12px;color:#999;margin-top:28px">You are getting this because you signed up at amaskitchen.com</p></div></body></html>`;
const ALL: EmailCard[] = [
  { id: "e1", name: "Welcome email", updatedAt: day(0), createdAt: day(30), html: mail("#f7f5ef", "#517a12", "Welcome to the kitchen", "Thanks for joining. Here is how to get the most out of your first week.") },
  { id: "e2", name: "Order receipt", updatedAt: day(3), createdAt: day(30), html: mail("#ffffff", "#3b5bdb", "Thanks for your order", "Your jollof spice kit is on its way. Here are the details.") },
  { id: "e3", name: "Monthly newsletter", updatedAt: day(9), createdAt: day(30), html: mail("#fff7e6", "#d9480f", "November recipes", "Three new dishes, one kitchen tip and a surprise for subscribers.") },
  { id: "e4", name: "Class reminder", updatedAt: day(21), createdAt: day(30), html: mail("#f1f3f5", "#7048e8", "Your class starts tomorrow", "Bring a sharp knife and an appetite. We begin at 6pm.") },
  { id: "e5", name: "Abandoned cart nudge", updatedAt: day(30), createdAt: day(40), html: mail("#fff0f0", "#c92a2a", "You left something behind", "Your basket is still waiting. Finish up in two minutes.") },
];
const DESIGNS = [
  { id: "d1", name: "Warm welcome", category: "Welcome", priceCents: 0 },
  { id: "d2", name: "Clean receipt", category: "Receipts", priceCents: 0 },
  { id: "d3", name: "Bold newsletter", category: "Newsletter", priceCents: 0 },
  { id: "d4", name: "Product launch", category: "Announcements", priceCents: 1200 },
  { id: "d5", name: "Event invite", category: "Events", priceCents: 0 },
  { id: "d6", name: "Thank-you note", category: "Thank you", priceCents: 0 },
];

export function EmailsPreview() {
  const q = useSearchParams();
  const state = q.get("state") ?? "ok";
  const dialog = q.get("dialog");
  const free = state === "limit";
  const initial = state === "empty" ? [] : free ? ALL.slice(0, 1) : ALL.slice(0, 3);
  return <EmailsLibrary key={`${state}-${dialog}`} initial={initial} limit={free ? 1 : 5} planName={free ? "Free" : "Starter"} designs={DESIGNS} preview openNew={!!dialog} />;
}
