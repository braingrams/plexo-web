"use client";

import "./learners.css";
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { Badge, ButtonLink, TabLinks } from "../ui";
import type { Experience } from "@/lib/dashboardV3/nav";
import { NewCourseDialog } from "./NewCourseDialog";

export type CourseLite = { id: string; name: string; address: string | null; live: boolean; learners: number; lessons: number };
export type CourseTabId = "learners" | "lessons" | "settings";

export function courseHref(id: string, tab: CourseTabId): string {
  return tab === "learners" ? `/dashboard/learners?course=${id}` : `/dashboard/learners/${id}/${tab}`;
}

/** The top of every course screen: which course, a picker when there are several, and its three tabs. */
export function CourseFrame({ courses, current, tab, experience, base = "/dashboard/learners", children }: { courses: CourseLite[]; current: CourseLite; tab: CourseTabId; experience: Experience; base?: string; children: React.ReactNode }) {
  const hrefFor = (id: string, t: CourseTabId) => (base === "/dashboard/learners" ? courseHref(id, t) : `${base}?course=${id}&tab=${t}`);
  const jargon = experience === "pro";
  const [creating, setCreating] = useState(false);
  return (
    <div className="plx-page plx-lrn" data-tour="learners-main">
      <header className="plx-lrn__head">
        <div>
          <h1 className="plx-h1">{courses.length > 1 ? "Courses and learners" : "Learners"}</h1>
          <p>{jargon ? "Everyone enrolled in your courses, their progress, and the lessons they can open." : "See who has signed up, how far they have got, and help them along."}</p>
        </div>
        <div className="plx-lrn__actions">
          {current.address ? (
            <ButtonLink href={`https://${current.address}`} target="_blank" rel="noreferrer" variant="secondary" rightIcon={<ExternalLink size={16} aria-hidden />}>
              Visit course
            </ButtonLink>
          ) : null}
        </div>
      </header>

      <nav className="plx-courses" aria-label="Your courses">
        {courses.map((c) => (
          <Link key={c.id} href={hrefFor(c.id, tab)} className="plx-course" aria-current={c.id === current.id ? "true" : undefined}>
            <b>{c.name}</b>
            <span>
              {c.learners} learner{c.learners === 1 ? "" : "s"} · {c.lessons} lesson{c.lessons === 1 ? "" : "s"}
            </span>
            <span>{c.live ? <Badge tone="success" dot>Open to sign-ups</Badge> : <Badge>Not open yet</Badge>}</span>
          </Link>
        ))}
        <button type="button" className="plx-course plx-course--add" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden /> New course
        </button>
        <NewCourseDialog open={creating} onClose={() => setCreating(false)} />
      </nav>

      <TabLinks
        label="This course"
        current={hrefFor(current.id, tab)}
        items={[
          { href: hrefFor(current.id, "learners"), label: "Learners" },
          { href: hrefFor(current.id, "lessons"), label: "Lessons" },
          { href: hrefFor(current.id, "settings"), label: "Price and sign-up" },
        ]}
      />
      {children}
    </div>
  );
}
