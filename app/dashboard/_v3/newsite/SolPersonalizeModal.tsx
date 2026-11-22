"use client";

import { Coins, FileText, MessageCircle, Palette } from "lucide-react";
import { Modal } from "@/app/dashboard/_v3/ui/Modal";
import { Button } from "@/app/dashboard/_v3/ui/Button";
import { SolGlyph } from "@/app/dashboard/_v3/sol/SolGlyph";

export type SolPersonalizeModalProps = {
  open: boolean;
  onClose: () => void;
  onProceed: () => void;
  onTopup: () => void;
  brandName: string;
  availableCredits?: number | null;
  creditCost?: number;
  paidBy?: "plexo" | "own-key";
};

/**
 * Transparent confirmation dialog before personalizing a template with SOL.
 * Explains exactly what SOL will tailor, the credit cost estimate, and current balance.
 */
export function SolPersonalizeModal({
  open,
  onClose,
  onProceed,
  onTopup,
  brandName,
  availableCredits,
  creditCost = 1,
  paidBy = "plexo",
}: SolPersonalizeModalProps) {
  const isByok = paidBy === "own-key";
  const hasCredits = isByok || (availableCredits !== null && availableCredits !== undefined && availableCredits >= creditCost);

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={500}
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: "var(--plx-tint)",
              color: "var(--plx-deep)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <SolGlyph size={18} />
          </div>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--plx-heading)" }}>
            Personalize with SOL
          </span>
        </div>
      }
      description={`SOL will tailor this design to ${brandName}. You watch it work, and it asks you if it needs anything.`}
      footer={
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, width: "100%" }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {hasCredits ? (
            <Button
              variant="primary"
              leftIcon={<SolGlyph size={14} />}
              onClick={onProceed}
            >
              Proceed with SOL
            </Button>
          ) : (
            <Button
              variant="primary"
              leftIcon={<SolGlyph size={14} />}
              onClick={onTopup}
            >
              Top up AI credits
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 4 }}>
        {/* What SOL will do */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: 14,
            borderRadius: 10,
            background: "var(--plx-surface)",
            border: "1px solid var(--plx-border)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--plx-muted)" }}>
            What SOL will customize
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--plx-body)" }}>
            <div style={{ marginTop: 2, color: "var(--plx-deep)" }}>
              <FileText size={16} />
            </div>
            <div>
              <strong style={{ color: "var(--plx-heading)" }}>Your words:</strong> Rewrites the headlines, cards, buttons and footer so they say what your business does.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--plx-body)" }}>
            <div style={{ marginTop: 2, color: "var(--plx-deep)" }}>
              <Palette size={16} />
            </div>
            <div>
              <strong style={{ color: "var(--plx-heading)" }}>Your name and logo:</strong> Uses your logo and colours, or your business name if you haven&apos;t added a logo.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, color: "var(--plx-body)" }}>
            <div style={{ marginTop: 2, color: "var(--plx-deep)" }}>
              <MessageCircle size={16} />
            </div>
            <div>
              <strong style={{ color: "var(--plx-heading)" }}>A few quick questions:</strong> Only what it truly needs, like where you are or how people reach you. You can skip any of them.
            </div>
          </div>
        </div>

        {/* AI Credit Balance & Estimation */}
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: hasCredits ? "var(--plx-tint)" : "var(--plx-sunken)",
            border: `1px solid ${hasCredits ? "var(--plx-border)" : "var(--plx-border-strong)"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "var(--plx-surface)",
                display: "grid",
                placeItems: "center",
                color: "var(--plx-deep)",
              }}
            >
              <Coins size={15} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--plx-heading)" }}>
                {isByok ? "Your AI Provider Key" : "AI Credit Cost"}
              </div>
              <div style={{ fontSize: 12, color: "var(--plx-muted)" }}>
                {isByok
                  ? "Billed directly by your provider (0 Plexo credits)"
                  : `Up to ${creditCost} ${creditCost === 1 ? "credit" : "credits"} for the whole page. You only pay for what SOL uses.`}
              </div>
            </div>
          </div>

          {!isByok && (
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: hasCredits ? "var(--plx-deep)" : "var(--plx-heading)",
                }}
              >
                {availableCredits ?? 0} {availableCredits === 1 ? "credit" : "credits"}
              </div>
              <div style={{ fontSize: 11, color: "var(--plx-muted)" }}>
                current balance
              </div>
            </div>
          )}
        </div>

        {!hasCredits && (
          <div style={{ fontSize: 12, color: "var(--plx-muted)", textAlign: "center" }}>
            You need at least {creditCost} {creditCost === 1 ? "credit" : "credits"} to personalize this template. Click below to add credits and continue seamlessly.
          </div>
        )}
      </div>
    </Modal>
  );
}
