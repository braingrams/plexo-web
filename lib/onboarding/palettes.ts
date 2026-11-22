export type PalettePreset = {
  id: string;
  name: string;
  colors: string[];
};

export const PALETTE_PRESETS: PalettePreset[] = [
  { id: "warm-earthy", name: "Warm & Earthy", colors: ["#E05D38", "#FBF8F3", "#292524", "#606C5D"] },
  { id: "bold-tech", name: "Bold & Tech", colors: ["#2563EB", "#06B6D4", "#0F172A", "#F0F9FF"] },
  { id: "fresh-emerald", name: "Fresh & Emerald", colors: ["#064E3B", "#10B981", "#F0FDF4", "#111827"] },
  { id: "creative-vibrant", name: "Creative & Vibrant", colors: ["#4F46E5", "#EC4899", "#18181B", "#FDF4FF"] },
  { id: "minimalist", name: "Minimalist Modern", colors: ["#18181B", "#71717A", "#FAFAFA", "#F4F4F5"] },
  { id: "warm-sunset", name: "Warm Sunset", colors: ["#F43F5E", "#F59E0B", "#FFFBEB", "#3E2723"] },
  { id: "luxury-gold", name: "Luxury Gold", colors: ["#451A03", "#D97706", "#FEF3C7", "#0C0A09"] },
  { id: "ocean-navy", name: "Ocean Navy", colors: ["#1E3A8A", "#38BDF8", "#EFF6FF", "#0F172A"] },
];
