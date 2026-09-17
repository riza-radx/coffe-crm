import { afterEach, describe, expect, it } from "vitest";
import { createInviteToken, inviteExpiry, inviteState } from "@/lib/invites";

const at = (iso: string) => new Date(iso);

describe("invite tokens", () => {
  afterEach(() => {
    delete process.env.INVITE_TTL_HOURS;
  });

  it("is URL-safe and long enough to resist guessing", () => {
    const token = createInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, createInviteToken));
    expect(tokens.size).toBe(500);
  });

  it("expires after the configured number of hours", () => {
    process.env.INVITE_TTL_HOURS = "72";
    const now = at("2026-09-17T10:00:00.000Z");
    expect(inviteExpiry(now).toISOString()).toBe("2026-09-20T10:00:00.000Z");
  });
});

describe("invite state machine", () => {
  const now = at("2026-09-17T10:00:00.000Z");

  it("accepts an unused, unexpired invite", () => {
    expect(inviteState({ expiresAt: at("2026-09-18T10:00:00.000Z"), acceptedAt: null }, now)).toBe(
      "VALID",
    );
  });

  it("rejects an unknown token", () => {
    expect(inviteState(null, now)).toBe("NOT_FOUND");
  });

  it("rejects an expired invite", () => {
    expect(inviteState({ expiresAt: at("2026-09-16T10:00:00.000Z"), acceptedAt: null }, now)).toBe(
      "EXPIRED",
    );
  });

  it("treats the exact expiry instant as expired", () => {
    expect(inviteState({ expiresAt: now, acceptedAt: null }, now)).toBe("EXPIRED");
  });

  it("rejects a token that was already used", () => {
    expect(
      inviteState({ expiresAt: at("2026-09-18T10:00:00.000Z"), acceptedAt: now }, now),
    ).toBe("ALREADY_USED");
  });

  it("reports a used-and-expired invite as used, not expired", () => {
    expect(
      inviteState({ expiresAt: at("2026-09-01T10:00:00.000Z"), acceptedAt: at("2026-08-30T10:00:00.000Z") }, now),
    ).toBe("ALREADY_USED");
  });
});
