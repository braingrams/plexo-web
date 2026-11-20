import { notFound } from "next/navigation";

export const metadata = { title: "Editor preview", robots: { index: false } };

/** DEV ONLY: the visual editor and its host screens with made-up data, for screenshots without a session or database. 404s anywhere but `next dev`. */
export default function EditorPreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return <>{children}</>;
}
