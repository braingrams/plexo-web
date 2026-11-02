import { describe, it, expect } from "vitest";
import { parseAdminGrant, adminEndpointsEnabled } from "@/lib/admin/adminGrant";

describe("parseAdminGrant", () => {
  it("accepts an email and a known role, normalizing the email", () => {
    expect(parseAdminGrant({ email: "  Ada@Example.com ", adminRole: "SUPERADMIN" })).toEqual({ email: "ada@example.com", adminRole: "SUPERADMIN" });
  });
  it("rejects a missing or malformed email", () => {
    expect(parseAdminGrant({ adminRole: "SUPPORT" })).toMatch(/valid email/);
    expect(parseAdminGrant({ email: "not-an-email", adminRole: "SUPPORT" })).toMatch(/valid email/);
  });
  it("rejects a role that isn't one of the four", () => {
    expect(parseAdminGrant({ email: "a@b.co", adminRole: "OWNER" })).toMatch(/adminRole/);
    expect(parseAdminGrant({ email: "a@b.co" })).toMatch(/adminRole/);
  });
  it("rejects a body that isn't an object", () => {
    expect(parseAdminGrant(null)).toMatch(/Send a JSON/);
  });
});

describe("adminEndpointsEnabled", () => {
  it("is on only when the stack flag is exactly true", () => {
    expect(adminEndpointsEnabled({ ADMIN_ENDPOINTS_ENABLED: "true" })).toBe(true);
    expect(adminEndpointsEnabled({ ADMIN_ENDPOINTS_ENABLED: "false" })).toBe(false);
    expect(adminEndpointsEnabled({ ADMIN_ENDPOINTS_ENABLED: "TRUE" })).toBe(false);
    expect(adminEndpointsEnabled({})).toBe(false);
  });
});
