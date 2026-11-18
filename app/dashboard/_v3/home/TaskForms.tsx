"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Landmark, Rocket, CreditCard } from "lucide-react";
import { parsePriceToMinor, suggestAddressLabel } from "@/lib/dashboardV3/tasks";
import { Button, ButtonLink, Input, SegmentedControl, useToast } from "../ui";
import { callApi } from "./api";

type Common = { siteId: string; demo?: boolean; onDone?: () => void };

function useRun(demo?: boolean) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(job: () => Promise<{ ok: true } | { ok: false; error: string }>, success?: string) {
    setBusy(true);
    setError("");
    const r = demo ? { ok: true as const } : await job();
    setBusy(false);
    if (!r.ok) return setError(r.error), false;
    if (success) toast.show({ title: success, tone: "success" });
    router.refresh();
    return true;
  }
  return { busy, error, setError, run };
}

const row: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 14, maxWidth: 520 };

/** Add first product: a name and a price, nothing else. */
export function ProductForm({ siteId, commerceEnabled, demo }: Common & { commerceEnabled: boolean }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const { busy, error, setError, run } = useRun(demo);
  const [nameErr, setNameErr] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const minor = parsePriceToMinor(price);
    setNameErr("");
    if (!name.trim()) return setNameErr("Please tell us what you're selling, like “Jollof rice tray”.");
    if (minor === null) return setError("Please add a price using numbers only, like 5,000.");
    await run(async () => {
      if (!commerceEnabled) {
        const on = await callApi(`/api/v1/commerce/${siteId}/settings`, "PUT", { enabled: true });
        if (!on.ok) return on;
      }
      return callApi(`/api/v1/commerce/${siteId}/products`, "POST", { name: name.trim(), kind: "PHYSICAL", priceMinor: minor });
    }, "Added. It shows on your site straight away.");
  }
  return (
    <form onSubmit={submit} style={row}>
      <Input label="What are you selling?" placeholder="Jollof rice tray" value={name} onChange={(e) => setName(e.target.value)} error={nameErr} autoComplete="off" />
      <Input label="Price" inputMode="decimal" placeholder="8,500" value={price} onChange={(e) => setPrice(e.target.value)} help="Just the number. You can add photos and more details later." error={error} />
      <div>
        <Button type="submit" size="lg" loading={busy} rightIcon={<ArrowRight size={18} aria-hidden />}>
          Add to my store
        </Button>
      </div>
    </form>
  );
}

type PayChoice = "card" | "bank";

/** Get paid: cards (Paystack) or a bank transfer, saved with the existing store settings. */
export function PayForm({ siteId, demo }: Common) {
  const [choice, setChoice] = useState<PayChoice>("card");
  const [pub, setPub] = useState("");
  const [secret, setSecret] = useState("");
  const [bank, setBank] = useState("");
  const [acctName, setAcctName] = useState("");
  const [acctNo, setAcctNo] = useState("");
  const { busy, error, setError, run } = useRun(demo);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (choice === "card") {
      if (!pub.trim() || !secret.trim()) return setError("Please paste both keys from your Paystack account.");
      await run(() => callApi(`/api/v1/commerce/${siteId}/settings`, "PUT", { enabled: true, paymentProvider: "BYO_PAYSTACK", paystackMode: "LIVE", paystackLivePublicKey: pub.trim(), paystackLiveSecretKey: secret.trim() }), "Card payments are on.");
    } else {
      if (!bank.trim() || !acctName.trim() || !acctNo.trim()) return setError("Please fill in your bank, the name on the account and the account number.");
      await run(() => callApi(`/api/v1/commerce/${siteId}/settings`, "PUT", { enabled: true, bankTransferEnabled: true, bankTransferBankName: bank.trim(), bankTransferAccountName: acctName.trim(), bankTransferAccountNumber: acctNo.trim() }), "Bank transfer is on.");
    }
  }
  return (
    <form onSubmit={submit} style={row}>
      <SegmentedControl<PayChoice>
        label="How do you want to get paid?"
        value={choice}
        onChange={(v) => (setChoice(v), setError(""))}
        options={[
          { value: "card", label: "Cards (recommended)", icon: <CreditCard size={16} aria-hidden /> },
          { value: "bank", label: "Bank transfer", icon: <Landmark size={16} aria-hidden /> },
        ]}
      />
      {choice === "card" ? (
        <>
          <p className="plx-small" style={{ margin: 0 }}>
            Customers pay by card and the money goes to your Paystack account. Copy the two keys from <strong>Settings → API keys</strong> in Paystack.
          </p>
          <Input label="Public key" value={pub} onChange={(e) => setPub(e.target.value)} placeholder="Starts with pk_live" autoComplete="off" />
          <Input label="Secret key" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Starts with sk_live" autoComplete="off" help="We keep this safe and never show it again." error={error} />
        </>
      ) : (
        <>
          <p className="plx-small" style={{ margin: 0 }}>Customers send the money to your account and you confirm it when it arrives. No sign-up with anyone else.</p>
          <Input label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} placeholder="Your bank's name" />
          <Input label="Name on the account" value={acctName} onChange={(e) => setAcctName(e.target.value)} />
          <Input label="Account number" inputMode="numeric" value={acctNo} onChange={(e) => setAcctNo(e.target.value)} error={error} />
        </>
      )}
      <div>
        <Button type="submit" size="lg" loading={busy}>
          Save how I get paid
        </Button>
      </div>
    </form>
  );
}

/** Pick the free web address (name + the platform ending). A taken name comes back as a plain sentence. */
export function AddressForm({ siteId, siteName, baseDomain, demo }: Common & { siteName: string; baseDomain: string }) {
  const [label, setLabel] = useState(suggestAddressLabel(siteName));
  const { busy, error, setError, run } = useRun(demo);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = label.trim().toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v)) return setError("Use only letters, numbers and dashes, like amas-kitchen.");
    await run(async () => {
      const r = await callApi("/api/v1/domains", "POST", { templateId: siteId, type: "SUBDOMAIN", domain: v });
      if (!r.ok && /already|taken|registered/i.test(r.error)) return { ok: false as const, error: "Someone already has that address. Try adding your town or a word, like amas-kitchen-lagos." };
      return r;
    }, "Your web address is ready.");
  }
  return (
    <form onSubmit={submit} style={row}>
      <Input label="Your web address" value={label} onChange={(e) => setLabel(e.target.value.toLowerCase().replace(/\s+/g, "-"))} error={error} help={`People will visit ${label || "your-name"}.${baseDomain}`} autoComplete="off" autoCapitalize="none" />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Button type="submit" size="lg" loading={busy}>
          Use this address
        </Button>
        <ButtonLink href="/dashboard/settings/domains" variant="link">
          Use my own .com instead
        </ButtonLink>
      </div>
    </form>
  );
}

/** The big one-tap "Put my site online". Calls the normal publish and tells the parent so it can celebrate. */
export function LiveForm({ siteId, onLive, demo }: Common & { onLive: () => void }) {
  const { busy, error, run } = useRun(demo);
  return (
    <div style={row}>
      <div>
        <Button
          size="lg"
          loading={busy}
          leftIcon={<Rocket size={18} aria-hidden />}
          onClick={async () => {
            const ok = await run(() => callApi(`/api/templates/${siteId}/publish`, "POST"));
            if (ok) onLive();
          }}
        >
          Put my site online
        </Button>
      </div>
      {error ? (
        <p className="plx-field__error" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : (
        <span className="plx-small">You can keep editing after it&apos;s online.</span>
      )}
    </div>
  );
}
