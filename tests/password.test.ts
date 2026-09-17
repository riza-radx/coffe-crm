import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("round-trips a correct password", async () => {
    const hash = await hashPassword("a-very-long-password");
    expect(hash).not.toBe("a-very-long-password");
    expect(await verifyPassword("a-very-long-password", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("a-very-long-password");
    expect(await verifyPassword("a-very-long-passwore", hash)).toBe(false);
  });

  it("returns false — without throwing — when the user has no password yet", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
  });

  it("salts, so the same password hashes differently every time", async () => {
    const [a, b] = await Promise.all([hashPassword("same-password"), hashPassword("same-password")]);
    expect(a).not.toBe(b);
  });
});
