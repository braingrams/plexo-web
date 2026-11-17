"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Monitor, Smartphone, Tablet } from "lucide-react";
import { Button, ButtonLink, Modal, SegmentedControl } from "../ui";

type Device = "desktop" | "tablet" | "phone";

/** A full-size look at a design, on a computer, tablet or phone, without leaving the list. */
export function DesignPreview({ designId, onClose }: { designId: string | null; onClose: () => void }) {
  const [state, setState] = useState<{ html: string; name: string; email: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");

  useEffect(() => {
    if (!designId) return;
    let cancelled = false;
    setState(null);
    setError(null);
    fetch(`/api/v1/marketplace/templates/${designId}/preview`)
      .then((res) => {
        if (!res.ok) throw new Error("We could not load this picture. Please try again.");
        return res.json();
      })
      .then((data: { html: string; name: string; kind?: string }) => {
        if (!cancelled) setState({ html: data.html, name: data.name, email: data.kind === "EMAIL" });
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "We could not load this picture. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [designId]);

  const widths: Record<Device, string> = { desktop: state?.email ? "720px" : "100%", tablet: "768px", phone: "375px" };

  return (
    <Modal
      open={designId !== null}
      onClose={onClose}
      width={1100}
      title={state ? state.name : "Loading the design"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {designId ? <ButtonLink href={`/dashboard/marketplace/${designId}`}>Use this design</ButtonLink> : null}
        </>
      }
    >
      <div className="plx-dzprev">
        <div className="plx-dzprev__bar">
          <SegmentedControl
            label="Screen size"
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "Computer", icon: <Monitor size={16} aria-hidden /> },
              { value: "tablet", label: "Tablet", icon: <Tablet size={16} aria-hidden /> },
              { value: "phone", label: "Phone", icon: <Smartphone size={16} aria-hidden /> },
            ]}
          />
        </div>
        <div className="plx-dzprev__stage">
          {error ? (
            <div className="plx-dzprev__state" role="alert">
              <b>{error}</b>
            </div>
          ) : state === null ? (
            <div className="plx-dzprev__state" role="status">
              <LoaderCircle size={26} className="plx-spin" aria-hidden />
              <span>Getting it ready…</span>
            </div>
          ) : (
            <iframe title={`Preview of ${state.name}`} srcDoc={state.html} sandbox="" className="plx-dzprev__frame" style={{ width: widths[device] }} />
          )}
        </div>
      </div>
    </Modal>
  );
}
