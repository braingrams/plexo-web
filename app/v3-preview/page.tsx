import { notFound } from "next/navigation";
import { Gallery } from "./Gallery";

export default function V3PreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Gallery />;
}
