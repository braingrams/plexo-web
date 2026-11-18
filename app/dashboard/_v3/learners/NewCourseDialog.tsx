"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Modal, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";

type SiteLite = { id: string; name: string };

/**
 * "New course": starts a course right here, no site wizard. Default path: name it and we make the course (with its own
 * sign-up page and a first lesson to start from). Secondary path: turn a site you already have into the course.
 */
export function NewCourseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { show } = useToast();
  const [name, setName] = useState("");
  const [sites, setSites] = useState<SiteLite[] | null>(null);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError(null);
    (async () => {
      try {
        const [t, f] = await Promise.all([
          hubApi<{ templates?: { id: string; name: string; kind?: string }[] }>("/api/templates"),
          hubApi<{ funnels?: { templateId: string }[]; slots?: { hasSlotAvailable: boolean } }>("/api/v1/lms/funnels"),
        ]);
        if (!alive) return;
        const taken = new Set((f.funnels ?? []).map((x) => x.templateId));
        setSites((t.templates ?? []).filter((x) => x.kind !== "EMAIL" && !taken.has(x.id)).map((x) => ({ id: x.id, name: x.name })));
        setFull(f.slots ? !f.slots.hasSlotAvailable : false);
      } catch {
        if (alive) setSites([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  async function makeCourse(templateId: string, label: string) {
    setBusy(label);
    setError(null);
    try {
      await hubApi("/api/v1/lms/funnels", { method: "POST", json: { templateId } }, "We couldn't set up your course. Please try again.");
      show({ title: "Your course is ready", description: "Add your first lesson next.", tone: "success" });
      onClose();
      router.push(`/dashboard/learners/${templateId}/lessons`);
      router.refresh();
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  async function createNew() {
    const title = name.trim();
    if (!title) return setError("Please give your course a name.");
    setBusy("new");
    setError(null);
    try {
      const made = await hubApi<{ template?: { id?: string }; id?: string }>("/api/templates", { method: "POST", json: { name: title, kind: "LANDING_PAGE" } }, "We couldn't start your course. Please try again.");
      const id = made.template?.id ?? made.id;
      if (!id) throw new Error("We couldn't start your course. Please try again.");
      await makeCourse(id, "new");
    } catch (e) {
      setError(errMsg(e));
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Start a new course"
      description="We set up the sign-up page and a first lesson. You add the rest."
      closeOnBackdrop={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Not now</Button>
          <Button loading={busy === "new"} disabled={full || !!busy} onClick={createNew}>Create my course</Button>
        </>
      }
    >
      <div className="plx-modal-stack">
        {full ? (
          <p className="plx-field__error" role="alert">You have used every course your plan includes. Upgrade your plan to add another.</p>
        ) : (
          <Input label="Course name" placeholder="For example: Learn to bake sourdough" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void createNew(); }} error={error ?? undefined} />
        )}
        {sites && sites.length > 0 && !full ? (
          <>
            <div className="plx-divider">or turn a site you already have into your course</div>
            <ul className="plx-ncl">
              {sites.map((s) => (
                <li key={s.id}>
                  <span>{s.name}</span>
                  <Button size="sm" variant="secondary" loading={busy === s.id} disabled={!!busy} onClick={() => { if (window.confirm(`Make "${s.name}" your course? Its home page becomes the course sign-up page. Your other pages stay as they are.`)) void makeCourse(s.id, s.id); }}>
                    Use this site
                  </Button>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
