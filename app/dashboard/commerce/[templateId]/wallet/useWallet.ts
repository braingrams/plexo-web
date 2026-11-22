"use client";

import { useState } from "react";
import { checkWithdrawal } from "@/lib/commerce/walletView";
import type { InitialWallet } from "./WalletClient";

/** The wallet's state and calls, shared by the old wallet page and the hub's "Your money". */
export function useWallet(templateId: string, initial: InitialWallet) {
  const [balanceCents, setBalanceCents] = useState(initial.balanceCents);
  const [pooled, setPooled] = useState(initial.pooled);
  const [ledger, setLedger] = useState(initial.ledger);
  const [ledgerTotal, setLedgerTotal] = useState(initial.ledgerTotal);
  const [ledgerPaging, setLedgerPaging] = useState({ page: initial.ledgerPage, pageSize: initial.ledgerPageSize });
  const [withdrawals, setWithdrawals] = useState(initial.withdrawals);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [togglingPooled, setTogglingPooled] = useState(false);

  const [showWithdrawForm, setShowWithdrawForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [bankName, setBankName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function loadLedger(next: { page: number; pageSize: number }) {
    setLoadingLedger(true);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/wallet?page=${next.page}&pageSize=${next.pageSize}`);
      const data = await res.json();
      if (res.ok) {
        setLedger(data.ledger);
        setLedgerTotal(data.ledgerTotal ?? data.ledger.length);
        setLedgerPaging({ page: data.page ?? next.page, pageSize: data.pageSize ?? next.pageSize });
      }
    } finally {
      setLoadingLedger(false);
    }
  }

  async function handleTogglePooled(next: boolean) {
    setTogglingPooled(true);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/wallet`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pooled: next }),
      });
      if (res.ok) {
        setPooled(next);
        const refreshed = await fetch(`/api/v1/commerce/${templateId}/wallet?page=1&pageSize=${ledgerPaging.pageSize}`).then((r) => r.json());
        setBalanceCents(refreshed.wallet.balanceCents);
        setLedger(refreshed.ledger);
        setLedgerTotal(refreshed.ledgerTotal ?? refreshed.ledger.length);
        setLedgerPaging({ page: refreshed.page ?? 1, pageSize: refreshed.pageSize ?? ledgerPaging.pageSize });
      }
    } finally {
      setTogglingPooled(false);
    }
  }

  async function handleWithdraw() {
    setMessage(null);
    const checked = checkWithdrawal({ amount, bankName, accountNumber, accountHolderName }, balanceCents, initial.currency);
    if (typeof checked === "string") {
      setMessage({ kind: "error", text: checked });
      return;
    }
    const { amountCents } = checked;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/commerce/${templateId}/wallet/withdrawals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents, accountNumber, accountHolderName, bankName }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't submit withdrawal request.");

      setBalanceCents((prev) => prev - amountCents);
      setWithdrawals((prev) => [{ id: data.withdrawal.id, amountCents, bankName, status: "PENDING", rejectionReason: null, requestedAt: new Date().toISOString(), processedAt: null }, ...prev]);
      setAmount("");
      setAccountNumber("");
      setAccountHolderName("");
      setBankName("");
      setShowWithdrawForm(false);
      setMessage({ kind: "success", text: "Withdrawal requested — it'll be processed by the Plexo team." });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Couldn't submit withdrawal request." });
    } finally {
      setSubmitting(false);
    }
  }

  return { balanceCents, pooled, ledger, ledgerTotal, ledgerPaging, withdrawals, loadingLedger, togglingPooled, showWithdrawForm, setShowWithdrawForm, amount, setAmount, accountNumber, setAccountNumber, accountHolderName, setAccountHolderName, bankName, setBankName, submitting, message, loadLedger, handleTogglePooled, handleWithdraw };
}
