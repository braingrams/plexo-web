import { requireHubContext } from "@/lib/dashboardV3/hubData";
import { loadCourseCards, loadCourseSettings, loadLessons, requireCourse } from "@/lib/dashboardV3/learnersData";
import { CourseFrame } from "../../../_v3/learners/CourseFrame";
import { LessonsManager } from "../../../_v3/learners/LessonsManager";
import { PriceStrip } from "../../../_v3/learners/PriceStrip";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lessons" };

export default async function LessonsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const ctx = await requireHubContext(`/dashboard/learners/${courseId}/lessons`);
  await requireCourse(ctx.organizationId, courseId);
  const [courses, lessons, cfg] = await Promise.all([loadCourseCards(ctx.organizationId), loadLessons(courseId), loadCourseSettings(courseId)]);
  const current = courses.find((c) => c.id === courseId)!;
  const product = cfg.products.find((p) => p.id === cfg.settings.signupProductId);
  return (
    <CourseFrame courses={courses} current={current} tab="lessons" experience={ctx.experience}>
      <PriceStrip courseId={courseId} paid={cfg.settings.signupMode === "PAID"} priceMinor={product?.priceMinor ?? null} currency={cfg.currency} />
      <LessonsManager courseId={courseId} initial={lessons} experience={ctx.experience} />
    </CourseFrame>
  );
}
