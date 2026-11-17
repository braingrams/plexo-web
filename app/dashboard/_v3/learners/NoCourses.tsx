"use client";

import { useState } from "react";
import { GraduationCap } from "lucide-react";
import { Button, EmptyState } from "../ui";
import { NewCourseDialog } from "./NewCourseDialog";

export function NoCourses() {
  const [open, setOpen] = useState(false);
  return (
    <div className="plx-page">
      <h1 className="plx-h1">Learners</h1>
      <EmptyState title="You don't have a course yet" body="Make a course and the people who sign up show up here, with how far they have got." illustration={<GraduationCap size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} action={<Button onClick={() => setOpen(true)}>Make a course</Button>} />
      <NewCourseDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
