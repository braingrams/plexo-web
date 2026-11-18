import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crypto", () => ({ decryptMaildripKey: () => "" }));
vi.mock("@/lib/brand/plexoBrand", () => ({ primeEmailBrand: () => undefined }));
vi.mock("@/lib/mail/logEmail", () => ({ logEmailDelivery: () => undefined }));

import { logoOrigin } from "@/lib/mail/maildrip";

describe("email logo address", () => {
  it("keeps a public https site address", () => {
    expect(logoOrigin("https://plexo.charisol.io")).toBe("https://plexo.charisol.io");
    expect(logoOrigin("https://staging-plexo.charisol.io")).toBe("https://staging-plexo.charisol.io");
  });
  it("never puts an address only this computer can open into an email", () => {
    for (const bad of ["http://localhost:3000", "https://localhost:3000", "http://127.0.0.1:3000", "http://plexo.charisol.io", "", "https://[::1]:3000"]) {
      expect(logoOrigin(bad)).toBe("https://plexo.charisol.io");
    }
  });
});
