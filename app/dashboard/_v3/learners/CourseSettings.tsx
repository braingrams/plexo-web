"use client";
import { GateOrError } from "@/app/dashboard/_components/UpgradePrompt";
import { planGateForMessage } from "@/lib/plan/planGate";
import { PLAN } from "@/lib/plan/plans";

import "./learners.css";
import { useState } from "react";
import { Copy } from "lucide-react";
import { Button, Card, CardHeader, Input, SegmentedControl, Select, useToast } from "../ui";
import { errMsg, hubApi } from "../hub/hubApi";
import { CourseFrame, type CourseLite } from "./CourseFrame";
import { formatMoney } from "@/lib/commerce/formatMoney";
import type { Experience } from "@/lib/dashboardV3/nav";
import type { CourseSettingsData } from "@/lib/dashboardV3/learnersData";

type Product = { id: string; name: string; priceMinor: number };

function Switch({ checked, onChange, label, help }: { checked: boolean; onChange: (v: boolean) => void; label: string; help?: string }) {
  return (
    <div className="plx-toggle">
      <span style={{ minWidth: 0 }}>
        <b style={{ display: "block", fontSize: 15 }}>{label}</b>
        {help ? <span className="plx-small">{help}</span> : null}
      </span>
      <input type="checkbox" className="plx-switch" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
    </div>
  );
}

/** Whether people can sign up, what it costs, and (for pros) the sign-up form options. */
export function CourseSettings({ courses, current, experience, initial, products: initialProducts, currency, embedSnippet, preview }: {
  courses: CourseLite[];
  current: CourseLite;
  experience: Experience;
  initial: CourseSettingsData;
  products: Product[];
  currency: string;
  embedSnippet: string;
  preview?: boolean;
}) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [products, setProducts] = useState(initialProducts);
  const [name, setName] = useState("Full course access");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [limitMsg, setLimitMsg] = useState<string | null>(null);
  const [redirect, setRedirect] = useState(initial.welcomeRedirectPath ?? "");
  const base = `/api/v1/lms/funnels/${current.id}`;

  async function save(patch: Partial<CourseSettingsData>) {
    const before = s;
    setS({ ...s, ...patch });
    try {
      if (!preview) await hubApi(base, { method: "PATCH", json: patch });
      toast.show({ title: "Saved", tone: "success", durationMs: 2200 });
    } catch (e) {
      setS(before);
      // A plan limit (rather than a hiccup) is explained with the upgrade prompt right here.
      if (planGateForMessage(errMsg(e))) setLimitMsg(errMsg(e));
      else toast.show({ title: "We couldn't save that", description: errMsg(e), tone: "danger" });
    }
  }

  async function createPrice() {
    const priceMinor = Math.round(Number(amount) * 100);
    if (!name.trim() || !Number.isFinite(priceMinor) || priceMinor <= 0) return toast.show({ title: "Add a name and a price above zero", tone: "danger" });
    setBusy(true);
    try {
      const made = preview
        ? { product: { id: "p-new", name: name.trim(), priceMinor } }
        : await hubApi<{ product: Product }>(`/api/v1/commerce/${current.id}/products`, { method: "POST", json: { name: name.trim(), kind: "DIGITAL", priceMinor, digitalDeliveryMethod: "ACCESS_LIST", digitalAccessInstructions: "You'll get access automatically by email as soon as payment goes through." } });
      setProducts((p) => [...p, { id: made.product.id, name: made.product.name, priceMinor }]);
      await save({ signupMode: "PAID", signupProductId: made.product.id });
    } catch (e) {
      if (planGateForMessage(errMsg(e))) setLimitMsg(errMsg(e));
      else toast.show({ title: "We couldn't set the price", description: errMsg(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const chosen = products.find((p) => p.id === s.signupProductId);
  return (
    <CourseFrame courses={courses} current={current} tab="settings" experience={experience}>
      {limitMsg ? <GateOrError error={limitMsg}>{null}</GateOrError> : null}
      <div className="plx-two">
        <div className="plx-hub__col">
          <Card padding="lg">
            <CardHeader title="Sign-ups" description="Turn this off to stop new people joining. People already in keep their access." />
            <Switch checked={s.enabled} onChange={(v) => save({ enabled: v })} label={s.enabled ? "Open to sign-ups" : "Closed to sign-ups"} help={s.enabled ? "Anyone with your course link can join." : "Your course page won't let anyone join."} />
          </Card>

          <Card padding="lg" data-tour="course-price">
            <CardHeader title="Price" description="Free, or one price for the whole course." />
            <div className="plx-form">
              <SegmentedControl label="Price" value={s.signupMode} onChange={(v) => (v === PLAN.FREE ? save({ signupMode: PLAN.FREE }) : products.length ? save({ signupMode: "PAID", signupProductId: s.signupProductId ?? products[0].id }) : setS({ ...s, signupMode: "PAID" }))} options={[{ value: PLAN.FREE, label: "Free" }, { value: "PAID", label: "Paid" }]} />
              {s.signupMode === "PAID" ? (
                products.length > 0 && s.signupProductId ? (
                  <>
                    <div className="plx-price"><b>{chosen ? formatMoney(chosen.priceMinor, currency) : ""}</b><span className="plx-small">{chosen?.name}</span></div>
                    <Select label="Charge using" value={s.signupProductId} onChange={(e) => save({ signupProductId: e.target.value })} options={products.map((p) => ({ value: p.id, label: `${p.name} (${formatMoney(p.priceMinor, currency)})` }))} />
                  </>
                ) : (
                  <div className="plx-form">
                    <div className="plx-form__two">
                      <Input label="What are they paying for?" value={name} onChange={(e) => setName(e.target.value)} />
                      <Input label={`Price (${currency})`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
                    </div>
                    <div><Button loading={busy} onClick={createPrice}>Set this price</Button></div>
                  </div>
                )
              ) : <p className="plx-small">Anyone can sign up for free. Switch to Paid to charge.</p>}
            </div>
          </Card>
        </div>

        <Card padding="lg">
          <CardHeader title="What people fill in" description="The sign-up form on your course page." />
          <div className="plx-form">
            <Switch checked={s.requireName} onChange={(v) => save({ requireName: v })} label="Ask for their name" />
            <Switch checked={s.collectPhone} onChange={(v) => save({ collectPhone: v })} label="Ask for a phone number" />
            {experience === "pro" ? (
              <details className="plx-more">
                <summary>More options</summary>
                <div className="plx-form" style={{ marginTop: 14 }}>
                  <Input label="After sign-up, send them to" help="A page on your site, like /welcome. Leave empty for the default." value={redirect} onChange={(e) => setRedirect(e.target.value)} onBlur={() => redirect !== (s.welcomeRedirectPath ?? "") && save({ welcomeRedirectPath: redirect.trim() || null })} placeholder="/welcome" />
                  <div>
                    <b style={{ fontSize: 14 }}>Put the sign-up form on any page</b>
                    <div className="plx-copybox"><code className="plx-mono" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{embedSnippet}</code><Button size="sm" variant="secondary" iconOnly aria-label="Copy the code" onClick={() => navigator.clipboard?.writeText(embedSnippet).then(() => toast.show({ title: "Copied", tone: "success", durationMs: 2000 }))}><Copy size={16} aria-hidden /></Button></div>
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        </Card>
      </div>
    </CourseFrame>
  );
}
