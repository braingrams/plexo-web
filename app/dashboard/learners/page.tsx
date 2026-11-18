import { requireHubContext } from "@/lib/dashboardV3/hubData";
import { loadCourseCards, loadLearners, loadLessons } from "@/lib/dashboardV3/learnersData";
import { LearnersView } from "../_v3/learners/LearnersView";
import { NoCourses } from "../_v3/learners/NoCourses";

export const dynamic = "force-dynamic";
export const metadata = { title: "Learners" };

/** Everyone taking your courses (v3 dashboard). Old funnel pages send people here when v3 is on. */
export default async function LearnersPage({ searchParams }: { searchParams: Promise<{ course?: string }> }) {
  const ctx = await requireHubContext("/dashboard/learners");
  const { course } = await searchParams;
  const courses = await loadCourseCards(ctx.organizationId);
  const current = courses.find((c) => c.id === course) ?? courses[0];
  if (!current) return <NoCourses />;
  const lessons = await loadLessons(current.id);
  const learners = await loadLearners(current.id, lessons);
  return <LearnersView courses={courses} current={current} lessons={lessons} learners={learners} experience={ctx.experience} />;
}
