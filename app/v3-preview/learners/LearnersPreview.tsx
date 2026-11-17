"use client";

import { useSearchParams } from "next/navigation";
import { CourseFrame, type CourseLite } from "@/app/dashboard/_v3/learners/CourseFrame";
import { CourseSettings } from "@/app/dashboard/_v3/learners/CourseSettings";
import { LearnersView } from "@/app/dashboard/_v3/learners/LearnersView";
import { LessonsManager } from "@/app/dashboard/_v3/learners/LessonsManager";
import { PriceStrip } from "@/app/dashboard/_v3/learners/PriceStrip";
import { parseExperience } from "@/lib/dashboardV3/nav";
import type { LearnerRow } from "@/lib/dashboardV3/learners";
import { rulesFromChoice, type LessonLite, type ProgressRow } from "@/lib/dashboardV3/lessonRules";

const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const TITLES = ["Welcome and what you will need", "Knife skills in ten minutes", "Stocks and sauces", "Your first full dish", "Feedback from me", "Plating and photos"];
const KINDS = ["WELCOME", "VIDEO", "VIDEO", "VIDEO", "DOCUMENT", "IMAGE"];
const lessons: LessonLite[] = TITLES.map((title, i) => ({
  id: `l${i}`,
  title,
  kind: KINDS[i],
  unlockRules: i === 0 ? rulesFromChoice("open", null) : i === 4 ? rulesFromChoice("approve", `l${i - 1}`) : i === 5 ? rulesFromChoice("days", null, 7) : rulesFromChoice("after_previous", `l${i - 1}`),
}));

const L = (email: string, name: string | null, p: Partial<LearnerRow>): LearnerRow => ({ email, name, status: "ACTIVE", paymentStatus: "FREE", enrolledAt: day(20), lastActiveAt: day(1), completedPageCount: 0, completedAt: null, waitingLessonId: null, ...p });
const learners: LearnerRow[] = [
  L("kofi.mensah@gmail.com", "Kofi Mensah", { paymentStatus: "PAID", completedPageCount: 6, completedAt: day(2), lastActiveAt: day(2), enrolledAt: day(40) }),
  L("adaeze@northwind.ng", "Adaeze Okafor", { paymentStatus: "PAID", completedPageCount: 4, waitingLessonId: "l4", lastActiveAt: day(0) }),
  L("tunde.b@outlook.com", "Tunde Bakare", { completedPageCount: 2, lastActiveAt: day(0), enrolledAt: day(6) }),
  L("zanele@mail.co.za", "Zanele Dlamini", { paymentStatus: "PAID", completedPageCount: 3, lastActiveAt: day(4), enrolledAt: day(12) }),
  L("sam.owusu@gmail.com", null, { completedPageCount: 1, lastActiveAt: day(11), enrolledAt: day(15) }),
  L("efua@hello.com", "Efua Asante", { completedPageCount: 0, lastActiveAt: null, enrolledAt: day(1) }),
  L("lindiwe@proton.me", "Lindiwe Ncube", { completedPageCount: 5, lastActiveAt: day(3), paymentStatus: "PAID", enrolledAt: day(30) }),
  L("old.friend@gmail.com", "Chidi Eze", { status: "REVOKED", completedPageCount: 1, lastActiveAt: day(50), enrolledAt: day(80) }),
];
const progress = (n: number, extra: ProgressRow[] = []): ProgressRow[] => [...Array.from({ length: n }, (_, i) => ({ pageId: `l${i}`, completedAt: day(10 - i) })), ...extra];
const PROGRESS: Record<string, ProgressRow[]> = {
  "kofi.mensah@gmail.com": progress(6, [{ pageId: "l4", adminApprovedAt: day(4), completedAt: day(4) }]),
  "adaeze@northwind.ng": progress(4),
  "tunde.b@outlook.com": progress(2),
  "zanele@mail.co.za": progress(3),
  "sam.owusu@gmail.com": progress(1),
  "efua@hello.com": [],
  "lindiwe@proton.me": progress(4),
  "old.friend@gmail.com": progress(1),
};
const courses: CourseLite[] = [
  { id: "c1", name: "Cooking with Ama", address: "learn.amaskitchen.com", live: true, learners: 7, lessons: 6 },
  { id: "c2", name: "Bread basics", address: null, live: false, learners: 0, lessons: 3 },
];

export function LearnersPreview() {
  const q = useSearchParams();
  const view = q.get("view") ?? "table";
  const experience = parseExperience(q.get("exp")) ?? "beginner";
  const list = q.get("courses") === "1" ? courses.slice(0, 1) : courses;
  const current = view === "empty" ? list[list.length - 1] : list[0];
  if (view === "lessons")
    return (
      <CourseFrame courses={list} current={current} tab="lessons" experience={experience}>
        <PriceStrip courseId="c1" paid priceMinor={1500000} currency="NGN" />
        <LessonsManager courseId="c1" initial={lessons} experience={experience} preview />
      </CourseFrame>
    );
  if (view === "settings")
    return (
      <CourseSettings courses={list} current={current} experience={experience} preview currency="NGN" embedSnippet='<div data-plexo-lms-signup="c1"></div>'
        initial={{ enabled: true, signupMode: "PAID", signupProductId: "p1", requireName: true, collectPhone: false, welcomeRedirectPath: null }}
        products={[{ id: "p1", name: "Full course access", priceMinor: 1500000 }]} />
    );
  return <LearnersView courses={list} current={current} lessons={lessons} learners={view === "empty" ? [] : learners} experience={experience} preview={{ progress: PROGRESS, openEmail: q.get("open") ?? undefined }} />;
}
