"use client";

import { useEffect, useState } from "react";
import { timeInputToMinutes, type HourRule } from "@/lib/commerce/bookingTimes";

export type Exception = { id: string; date: string; closed: boolean };

/** One service's weekly hours and closed dates, with the calls to change them. Shared by the hub and the old page. */
export function useAvailability(templateId: string, productId: string) {
  const [rules, setRules] = useState<HourRule[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) return;
    let live = true;
    setLoading(true);
    fetch(`/api/v1/commerce/${templateId}/availability?productId=${productId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!live) return;
        setRules(data.rules ?? []);
        setExceptions(data.exceptions ?? []);
      })
      .catch(() => live && setError("We couldn't load your booking times. Please refresh."))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [templateId, productId]);

  async function addRule(r: { dayOfWeek: number; start: string; end: string; timezone: string }): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "rule", productId, dayOfWeek: r.dayOfWeek, startMinute: timeInputToMinutes(r.start), endMinute: timeInputToMinutes(r.end), timezone: r.timezone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "We couldn't add those hours.");
      setRules((prev) => [...prev, data.rule].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't add those hours.");
      return false;
    }
  }
  async function deleteRule(id: string) {
    await fetch(`/api/v1/commerce/${templateId}/availability/${id}?type=rule`, { method: "DELETE" });
    setRules((prev) => prev.filter((r) => r.id !== id));
  }
  async function addException(date: string): Promise<boolean> {
    setError(null);
    if (!date) {
      setError("Pick the date you will be closed.");
      return false;
    }
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "exception", productId, date }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "We couldn't close that date.");
      setExceptions((prev) => [...prev, data.exception].sort((a, b) => a.date.localeCompare(b.date)));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't close that date.");
      return false;
    }
  }
  async function deleteException(id: string) {
    await fetch(`/api/v1/commerce/${templateId}/availability/${id}?type=exception`, { method: "DELETE" });
    setExceptions((prev) => prev.filter((e) => e.id !== id));
  }

  return { rules, exceptions, loading, error, setError, addRule, deleteRule, addException, deleteException };
}
