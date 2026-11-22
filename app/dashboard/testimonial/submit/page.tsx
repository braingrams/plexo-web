import { auth } from "@/server/authDynamo";
import { User } from "@/lib/db/coreEntities";
import { ensureActiveOrganization } from "@/server/orgDynamo";
import { readBuildProfile } from "@/lib/dashboardV3/profile";
import { redirect } from "next/navigation";
import { TestimonialSubmitClient } from "./TestimonialSubmitClient";

export const metadata = {
  title: "Drop a Testimonial | Plexo",
  description: "Share your experience building with Plexo.",
};

export default async function TestimonialSubmitPage() {
  const session = await auth();
  if (!session?.user) {
    redirect("/auth/login?redirect=/dashboard/testimonial/submit");
  }

  const { data: dbUser } = await User.get({ id: session.user.id }).go();
  const orgResolution = await ensureActiveOrganization(session.user.id);

  let orgName = "";
  if (orgResolution.status === "resolved") {
    if (orgResolution.organizationName && orgResolution.organizationName !== "My Workspace") {
      orgName = orgResolution.organizationName;
    }
  }

  const buildProfile = readBuildProfile(dbUser?.buildProfile);
  const brandName = buildProfile?.brand?.name;

  const defaultName = dbUser?.name ?? session.user.name ?? "";
  const defaultAvatar = dbUser?.image ?? session.user.image ?? "";
  const defaultCompany = brandName || orgName || "";
  const defaultRole = defaultCompany ? `Founder, ${defaultCompany}` : "Plexo Creator";

  return (
    <TestimonialSubmitClient
      user={{
        name: defaultName,
        email: dbUser?.email ?? session.user.email ?? "",
        avatarUrl: defaultAvatar,
        company: defaultCompany,
        role: defaultRole,
      }}
    />
  );
}
