/**
 * Shown under a SOL turn that finished a step after the credits had run out, leaving the
 * balance below zero. SOL finishes the step it was already on rather than stopping, because a
 * half-done app is worse for the owner than a small overdraft — this says so in plain words
 * instead of leaving a surprise negative number.
 */
export function CreditOverdraftNotice({ balance }: { balance: number }) {
  return (
    <div role="status" style={{ marginBottom: "0.6rem", padding: "0.65rem 0.9rem", borderRadius: 10, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", color: "#fcd34d", fontSize: "0.78rem", lineHeight: 1.55 }}>
      <strong style={{ color: "#fde68a" }}>Your credits ran out partway through.</strong>{" "}
      We let SOL finish the step it was on instead of stopping, so your work isn&apos;t left half-done. That took your balance to{" "}
      <strong>{balance.toLocaleString()}</strong> — it&apos;s taken off your next monthly credits or top-up.{" "}
      <a href="/dashboard/settings/subscription" style={{ color: "#fde68a", textDecoration: "underline", fontWeight: 600 }}>Add credits</a>
    </div>
  );
}
