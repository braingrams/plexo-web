"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ButtonLink, Card, EmptyState, Input, Notice, Select, Textarea } from "../ui";
import { designKindLabel } from "@/lib/dashboardV3/designs";

export type SellOption = { id: string; name: string; kind: "EMAIL" | "LANDING_PAGE"; hasContent: boolean };

/** Put one of your own pages or emails up for sale. Same request as before. */
export function SellDesignForm({ options, autoPublish, fee, keep }: { options: SellOption[]; autoPublish: boolean; fee: string; keep: string }) {
  const router = useRouter();
  const firstUsable = options.find((o) => o.hasContent)?.id ?? "";
  const [templateId, setTemplateId] = useState(firstUsable);
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!templateId) return setError("Please choose which page or email to sell.");
    const n = Number(price);
    if (price.trim() && (!Number.isFinite(n) || n < 0)) return setError("The price should be a number like 15, or leave it empty to give it away free.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/marketplace/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, priceCents: price.trim() ? Math.round(n * 100) : 0, category: category.trim() || null, description: description.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "We could not put it up for sale. Please try again.");
      router.push("/dashboard/marketplace/listings");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not put it up for sale. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (options.length === 0) {
    return (
      <EmptyState
        title="You have nothing to sell yet"
        body="Make a page or an email first. Then come back here to share it with others."
        action={<ButtonLink href="/dashboard/new">Make a page</ButtonLink>}
      />
    );
  }

  return (
    <Card padding="lg">
      <form onSubmit={submit} className="plx-dzform plx-dzform--wide" noValidate>
        <Select
          label="What would you like to sell?"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          options={options.map((o) => ({ value: o.id, label: `${o.name} (${designKindLabel(o.kind)})${o.hasContent ? "" : " - nothing on it yet"}`, disabled: !o.hasContent }))}
        />
        <Input label="Price in US dollars" optional help={`Leave empty to give it away free. If you charge, you keep ${keep}% and Plexo keeps ${fee}%.`} type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" />
        <Input label="What kind of business is it for?" optional help="So people can find it, like Restaurant, Portfolio or Online store." value={category} onChange={(e) => setCategory(e.target.value)} />
        <Textarea label="Tell people about it" optional rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        {error ? <Notice kind="error" title="Check the form">{error}</Notice> : null}
        <div>
          <Button type="submit" size="lg" loading={submitting} loadingLabel="Putting it up for sale">
            {autoPublish ? "Put it up for sale" : "Send it to be checked"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
