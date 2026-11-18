import { PLAN } from "@/lib/plan/plans";
import { notFound } from "next/navigation";
import { LmsEnrollment, LmsFunnel, LmsPage, LmsPageProgress, PublishedDomain, Template } from "@/lib/db/contentEntities";
import { CommerceProduct, CommerceSettings } from "@/lib/db/commerceEntities";
import { lmsSignupEmbedSnippet } from "@/lib/lms/embedSnippet";
import type { LmsPageUnlockRules } from "@/lib/lms/rules";
import type { LearnerRow } from "./learners";
import { waitingLesson, type LessonLite } from "./lessonRules";

export type CourseCard = { id: string; name: string; address: string | null; live: boolean; learners: number; lessons: number; updatedAt: string };

async function addressOf(organizationId: string, templateId: string): Promise<string | null> {
  const { data } = await PublishedDomain.query.primary({ templateId }).go({ pages: "all" });
  const own = data.filter((d) => d.active !== false && d.organizationId === organizationId);
  return (own.find((d) => d.type === "CUSTOM") ?? own[0])?.domain ?? null;
}

/** Every course in the workspace (most recently changed first), with the numbers a picker shows. */
export async function loadCourseCards(organizationId: string): Promise<CourseCard[]> {
  const { data: funnels } = await LmsFunnel.query.byOrg({ organizationId }).go({ pages: "all" });
  const cards = await Promise.all(
    funnels.map(async (f) => {
      const [{ data: t }, address, { data: enrollments }, { data: pages }] = await Promise.all([
        Template.get({ id: f.templateId }).go({ attributes: ["name", "organizationId"] }),
        addressOf(organizationId, f.templateId),
        LmsEnrollment.query.byEnrolledAt({ templateId: f.templateId }).go({ pages: "all", attributes: ["email", "status"] }),
        LmsPage.query.byOrder({ templateId: f.templateId }).go({ pages: "all", attributes: ["id"] }),
      ]);
      return {
        id: f.templateId,
        name: t?.name || "Untitled course",
        address,
        live: f.enabled !== false,
        learners: enrollments.filter((e) => e.status !== "REVOKED").length,
        lessons: pages.length,
        updatedAt: f.updatedAt ?? "",
      } satisfies CourseCard;
    }),
  );
  return cards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export type CourseLesson = LessonLite & { order: number; unlockRules: LmsPageUnlockRules | null };

export async function loadLessons(templateId: string): Promise<CourseLesson[]> {
  const { data } = await LmsPage.query.byOrder({ templateId }).go({ pages: "all" });
  return data
    .sort((a, b) => a.order - b.order)
    .map((p) => ({ id: p.id, title: p.title, kind: p.kind, order: p.order, visible: p.visible !== false, unlockRules: (p.unlockRules as LmsPageUnlockRules | undefined) ?? null }));
}

/** A course the signed-in workspace owns, or a 404. */
export async function requireCourse(organizationId: string, templateId: string) {
  const { data: funnel } = await LmsFunnel.get({ templateId }).go();
  if (!funnel || funnel.organizationId !== organizationId) notFound();
  const { data: t } = await Template.get({ id: templateId }).go({ attributes: ["name"] });
  return { funnel, name: t?.name || "Untitled course", address: await addressOf(organizationId, templateId) };
}

export async function loadLearners(templateId: string, lessons: CourseLesson[]): Promise<LearnerRow[]> {
  const [{ data: enrollments }, { data: progress }] = await Promise.all([
    LmsEnrollment.query.byEnrolledAt({ templateId }).go({ pages: "all" }),
    LmsPageProgress.query.primary({ templateId }).go({ pages: "all" }),
  ]);
  const byEmail = new Map<string, typeof progress>();
  for (const p of progress) byEmail.set(p.email, [...(byEmail.get(p.email) ?? []), p]);
  const gated = lessons.some((l) => l.unlockRules?.conditions.some((c) => c.type === "MANUAL_APPROVAL"));
  return enrollments
    .sort((a, b) => (b.enrolledAt ?? "").localeCompare(a.enrolledAt ?? ""))
    .map((e) => ({
      email: e.email,
      name: e.name ?? null,
      status: e.status ?? "ACTIVE",
      paymentStatus: e.paymentStatus ?? PLAN.FREE,
      enrolledAt: e.enrolledAt ?? new Date().toISOString(),
      lastActiveAt: e.lastActiveAt ?? null,
      completedPageCount: e.completedPageCount ?? 0,
      completedAt: e.completedAt ?? null,
      waitingLessonId: gated && e.status !== "REVOKED" ? waitingLesson(lessons, e.enrolledAt ?? new Date().toISOString(), byEmail.get(e.email) ?? [])?.id ?? null : null,
    }));
}

export type CourseSettingsData = {
  enabled: boolean;
  signupMode: "FREE" | "PAID";
  signupProductId: string | null;
  requireName: boolean;
  collectPhone: boolean;
  welcomeRedirectPath: string | null;
};

export async function loadCourseSettings(templateId: string) {
  const [{ data: funnel }, { data: products }, { data: commerce }] = await Promise.all([
    LmsFunnel.get({ templateId }).go(),
    CommerceProduct.query.primary({ templateId }).go({ pages: "all" }),
    CommerceSettings.get({ templateId }).go(),
  ]);
  return {
    settings: {
      enabled: funnel?.enabled ?? false,
      signupMode: funnel?.signupMode ?? PLAN.FREE,
      signupProductId: funnel?.signupProductId ?? null,
      requireName: funnel?.requireName ?? true,
      collectPhone: funnel?.collectPhone ?? false,
      welcomeRedirectPath: funnel?.welcomeRedirectPath ?? null,
    } satisfies CourseSettingsData,
    products: products.map((p) => ({ id: p.id, name: p.name, priceMinor: p.priceMinor ?? 0 })),
    currency: commerce?.currency ?? "NGN",
    embedSnippet: lmsSignupEmbedSnippet(templateId),
  };
}
