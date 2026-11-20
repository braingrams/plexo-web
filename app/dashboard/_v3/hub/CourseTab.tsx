"use client";

import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { useCallback, useEffect, useState } from "react";
import { Settings2, Users } from "lucide-react";
import { ButtonLink, Skeleton } from "../ui";
import { LessonsManager } from "../learners/LessonsManager";
import { TabBar } from "./HubFrame";
import { errMsg, hubApi } from "./hubApi";
import type { LessonLite } from "@/lib/dashboardV3/lessonRules";
import type { Experience } from "@/lib/dashboardV3/nav";

/** The site hub's Course tab: the lessons (add, reorder, when they open), with the learners and the price one tap away. */
export function CourseTab({ siteId, experience = "beginner" }: { siteId: string; experience?: Experience }) {
  const [lessons, setLessons] = useState<LessonLite[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setLessons((await hubApi<{ pages: LessonLite[] }>(`/api/v1/lms/funnels/${siteId}/pages`)).pages);
    } catch (e) {
      setError(errMsg(e, "We couldn't load your course."));
    }
  }, [siteId]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <>
      <TabBar
        title="Your course"
        sub="The lessons people work through, in order."
        action={
          <span style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <ButtonLink href={`/dashboard/learners?course=${siteId}`} variant="secondary" leftIcon={<Users size={18} aria-hidden />}>See learners</ButtonLink>
            <ButtonLink href={`/dashboard/learners/${siteId}/settings`} variant="secondary" leftIcon={<Settings2 size={18} aria-hidden />}>Price and sign-up</ButtonLink>
          </span>
        }
      />
      {error ? <GateOrError error={error}><div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{error}</div></GateOrError> : null}
      {lessons === null && !error ? <Skeleton style={{ height: 200, borderRadius: 20 }} /> : null}
      {lessons ? <LessonsManager courseId={siteId} initial={lessons} experience={experience} /> : null}
    </>
  );
}
