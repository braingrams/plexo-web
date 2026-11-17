import { requireHubContext } from "@/lib/dashboardV3/hubData";
import { loadCourseCards, loadCourseSettings, requireCourse } from "@/lib/dashboardV3/learnersData";
import { CourseSettings } from "../../../_v3/learners/CourseSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Price and sign-up" };

export default async function CourseSettingsPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const ctx = await requireHubContext(`/dashboard/learners/${courseId}/settings`);
  await requireCourse(ctx.organizationId, courseId);
  const [courses, cfg] = await Promise.all([loadCourseCards(ctx.organizationId), loadCourseSettings(courseId)]);
  return <CourseSettings courses={courses} current={courses.find((c) => c.id === courseId)!} experience={ctx.experience} initial={cfg.settings} products={cfg.products} currency={cfg.currency} embedSnippet={cfg.embedSnippet} />;
}
