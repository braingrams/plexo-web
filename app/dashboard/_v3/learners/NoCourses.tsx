import { GraduationCap } from "lucide-react";
import { ButtonLink, EmptyState } from "../ui";

export function NoCourses() {
  return (
    <div className="plx-page">
      <h1 className="plx-h1">Learners</h1>
      <EmptyState title="You don't have a course yet" body="Make a course and the people who sign up show up here, with how far they have got." illustration={<GraduationCap size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />} action={<ButtonLink href="/dashboard/new">Make a course</ButtonLink>} />
    </div>
  );
}
