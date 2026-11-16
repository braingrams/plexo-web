import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";

// v3 only: Plus Jakarta Sans for everything, JetBrains Mono for the rare bit of code. The old
// dashboard and marketing site keep Figtree/Geist (app/layout.tsx).
export const v3Sans = Plus_Jakarta_Sans({ subsets: ["latin"], display: "swap", variable: "--font-v3-sans" });
export const v3Mono = JetBrains_Mono({ subsets: ["latin"], display: "swap", variable: "--font-v3-mono" });
