/** Read-only: finds the owner account and what it already has. Writes nothing. */
import { User, Organization, Member } from "../../lib/db/coreEntities";
import { Template } from "../../lib/db/contentEntities";

async function main() {
  const email = "admin@serenitypashomecare.com";
  const { data: users } = await User.query.byEmail({ email }).go();
  console.log("users:", users.map((u) => ({ id: u.id, plan: u.subscriptionPlan, name: u.name })));
  for (const u of users) {
    const { data: members } = await Member.query.byUser({ userId: u.id }).go({ pages: "all" }).catch(() => ({ data: [] as any[] }));
    console.log("members:", members.map((m: any) => ({ org: m.organizationId, role: m.role })));
    for (const m of members) {
      const { data: org } = await Organization.get({ id: m.organizationId }).go();
      console.log("org:", org && { id: org.id, name: org.name, ownerId: (org as any).ownerId });
      const { data: ts } = await Template.query.byOrg({ organizationId: m.organizationId }).go({ pages: "all" });
      console.log("templates:", ts.map((t: any) => ({ id: t.id, name: t.name, parent: t.parentId, kind: t.kind, fmt: t.designFormat })));
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
