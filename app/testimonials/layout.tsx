import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Share Your Story",
  description: "Tell us about your experience building with Plexo — your story may be featured on the site.",
  robots: { index: false, follow: true },
};

export default function TestimonialsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
