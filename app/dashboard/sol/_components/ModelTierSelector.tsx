"use client";

import { CustomSelect } from "@/app/_components/CustomSelect";
import { MODEL_TIER_OPTIONS, type ModelTier } from "./types";

export function ModelTierSelector({
  value,
  onChange,
  disabled,
  className,
  menuWidth,
}: {
  value: ModelTier;
  onChange: (tier: ModelTier) => void;
  disabled?: boolean;
  className?: string;
  menuWidth?: number;
}) {
  return (
    <CustomSelect
      value={value}
      disabled={disabled}
      className={className}
      menuWidth={menuWidth}
      onChange={(v) => onChange(v as ModelTier)}
      options={MODEL_TIER_OPTIONS.map((t) => ({ value: t.value, label: t.label, description: t.description }))}
    />
  );
}
