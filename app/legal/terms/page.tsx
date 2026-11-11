import { redirect } from "next/navigation";

// The Terms of Service lives on Plexo's public website, so there is one copy to keep up to date.
// This keeps the old in-app address working.
export default function TermsofServiceRedirect(): never {
  redirect("https://www.plexopages.com/terms");
}
