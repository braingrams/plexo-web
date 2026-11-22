"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Monitor, Smartphone, Tablet } from "lucide-react";
import { Button, ButtonLink, Modal, SegmentedControl } from "../ui";

type Device = "desktop" | "tablet" | "phone";

/** A full-size look at a design, on a computer, tablet or phone, without leaving the list. */
export function DesignPreview({ designId, onClose, onUse, useLabel = "Use this design" }: { designId: string | null; onClose: () => void; /** Instead of opening the marketplace page, this runs when they choose "Use this design" (the onboarding picker). */ onUse?: (designId: string) => void; useLabel?: string }) {
  const [state, setState] = useState<{ html: string; name: string; email: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>("desktop");
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 600 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      if (el.clientWidth > 0 && el.clientHeight > 0) {
        setStageSize({ width: Math.max(0, el.clientWidth - 24), height: Math.max(0, el.clientHeight - 24) });
      }
    };
    update();
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setStageSize({ width, height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [designId]);

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

  const targetWidth =
    device === "desktop"
      ? state?.email
        ? 720
        : 1280
      : device === "tablet"
        ? 768
        : 375;

  const availW = stageSize.width || targetWidth;
  const availH = stageSize.height || 600;
  const scale = availW < targetWidth ? availW / targetWidth : 1;
  const visualWidth = Math.round(targetWidth * scale);
  const frameHeight = scale > 0 ? Math.round(availH / scale) : availH;

  return (
    <Modal
      open={designId !== null}
      onClose={onClose}
      width={1180}
      title={state ? state.name : "Loading the design"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {designId ? (onUse ? <Button onClick={() => { onClose(); onUse(designId); }}>{useLabel}</Button> : <ButtonLink href={`/dashboard/marketplace/${designId}`}>Use this design</ButtonLink>) : null}
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
        <div ref={stageRef} className="plx-dzprev__stage" style={{ display: "flex", justifyContent: "center", alignItems: "stretch" }}>
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
            <div
              style={{
                position: "relative",
                width: `${visualWidth}px`,
                height: "100%",
                borderRadius: 10,
                overflow: "hidden",
                background: "Canvas",
                transition: "width 0.2s ease",
              }}
            >
              <iframe
                title={`Preview of ${state.name}`}
                srcDoc={state.html}
                sandbox=""
                className="plx-dzprev__frame"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: `${targetWidth}px`,
                  height: `${frameHeight}px`,
                  transform: scale < 1 ? `scale(${scale})` : undefined,
                  transformOrigin: "top left",
                  border: 0,
                  borderRadius: 10,
                  background: "Canvas",
                  colorScheme: "light",
                }}
              />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
