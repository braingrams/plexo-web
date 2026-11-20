"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Plus, X } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Input, Select, Skeleton } from "../../ui";
import { DAY_NAMES, WEEKDAYS, WEEK_ORDER, friendlyTime, hoursProblem, weekRows } from "@/lib/commerce/bookingTimes";
import { hubTabHref } from "@/lib/dashboardV3/hubTabs";
import { useAvailability } from "@/app/dashboard/commerce/[templateId]/availability/useAvailability";

type Service = { id: string; name: string; durationMinutes: number | null };

const localZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Lagos";
  } catch {
    return "Africa/Lagos";
  }
};

/** "Booking times" in the hub: when people can book each service, by day of the week, plus dates you're closed. */
export function BookingPanel({ templateId, services }: { templateId: string; services: Service[] }) {
  const [productId, setProductId] = useState(services[0]?.id ?? "");
  const a = useAvailability(templateId, productId);
  const [day, setDay] = useState(1);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [zone, setZone] = useState(localZone);
  const [closedOn, setClosedOn] = useState("");
  const [busy, setBusy] = useState(false);

  if (services.length === 0) {
    return (
      <EmptyState
        title="Add something people can book"
        body="Booking times belong to a service, like a haircut or a consultation. Add a service first and come back to choose when people can book it."
        action={<Link className="plx-btn plx-btn--primary" href={`${hubTabHref(templateId, "products")}&new=service`}>Add a service</Link>}
        illustration={<CalendarClock size={72} aria-hidden style={{ color: "var(--plx-deep)" }} />}
      />
    );
  }

  const week = weekRows(a.rules);
  async function add() {
    const problem = hoursProblem(start, end, a.rules, day);
    if (problem) return a.setError(problem);
    setBusy(true);
    await a.addRule({ dayOfWeek: day, start, end, timezone: zone });
    setBusy(false);
  }
  async function weekdays() {
    setBusy(true);
    for (const d of WEEKDAYS) if (!hoursProblem("09:00", "17:00", a.rules, d)) await a.addRule({ dayOfWeek: d, start: "09:00", end: "17:00", timezone: zone });
    setBusy(false);
  }

  return (
    <div className="plx-book">
      {services.length > 1 ? <Select label="Which service?" value={productId} onChange={(e) => setProductId(e.target.value)} options={services.map((s) => ({ value: s.id, label: s.name }))} fieldClassName="plx-book__pick" /> : <p className="plx-small">Times for <b>{services[0].name}</b></p>}

      <Card padding="lg">
        <CardHeader title="Your week" description="The hours people can book. A day with no hours can't be booked." action={a.rules.length === 0 ? <Button size="sm" variant="secondary" loading={busy} onClick={weekdays}>Use Monday to Friday, 9 to 5</Button> : undefined} />
        {a.loading ? (
          <div style={{ marginTop: 12 }}><Skeleton style={{ height: 120 }} /></div>
        ) : (
          <ul className="plx-week">
            {week.map((r) => (
              <li key={r.day} className="plx-week__row">
                <b className="plx-week__day">{r.name}</b>
                <span className="plx-week__times">
                  {r.windows.length === 0 ? <span className="plx-small">Closed</span> : r.windows.map((w) => (
                    <span key={w.id} className="plx-week__chip">
                      {friendlyTime(w.startMinute)} to {friendlyTime(w.endMinute)}
                      <button type="button" aria-label={`Remove ${r.name} ${friendlyTime(w.startMinute)} to ${friendlyTime(w.endMinute)}`} onClick={() => void a.deleteRule(w.id)}><X size={14} aria-hidden /></button>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="plx-book__add">
          <Select label="Day" value={String(day)} onChange={(e) => setDay(Number(e.target.value))} options={WEEK_ORDER.map((d) => ({ value: String(d), label: DAY_NAMES[d] }))} />
          <Input label="Opens" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <Input label="Closes" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          <Button leftIcon={<Plus size={16} aria-hidden />} loading={busy} onClick={add}>Add hours</Button>
        </div>
        <p className="plx-small">Times are in <b>{zone}</b>. <button type="button" className="plx-linkbtn" onClick={() => { const z = window.prompt("Which time zone? For example Africa/Lagos or Europe/London", zone); if (z?.trim()) setZone(z.trim()); }}>Change</button></p>
      </Card>

      <Card padding="lg">
        <CardHeader title="Days you're closed" description="Holidays or days off. People can't book these dates, even if your week says you're open." />
        {a.exceptions.length === 0 ? <p className="plx-small" style={{ marginTop: 12 }}>No days off set.</p> : (
          <ul className="plx-week">
            {a.exceptions.map((x) => (
              <li key={x.id} className="plx-week__row">
                <b className="plx-week__day" style={{ width: "auto" }}>{new Date(x.date).toLocaleDateString("en", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</b>
                <Button variant="ghost" size="sm" onClick={() => void a.deleteException(x.id)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        <div className="plx-book__add">
          <Input label="Closed on" type="date" value={closedOn} onChange={(e) => setClosedOn(e.target.value)} />
          <Button variant="secondary" onClick={async () => { if (await a.addException(closedOn)) setClosedOn(""); }}>Close this date</Button>
        </div>
      </Card>
      {a.error ? <div className="plx-inlinemsg plx-inlinemsg--bad" role="alert">{a.error}</div> : null}
    </div>
  );
}
