import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bodyWithLink, resetTransport, sendMail, transport } from "@/lib/email/mailer";

const ENV = { ...process.env };

beforeEach(() => {
  delete process.env.SMTP_HOST;
  process.env.AUTH_URL = "https://crm.radx.app";
  resetTransport();
});

afterEach(() => {
  process.env = { ...ENV };
  resetTransport();
  vi.restoreAllMocks();
});

describe("mailer without SMTP configured", () => {
  it("builds the message and reports that it was not delivered", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const result = await sendMail({
      to: "rep@radx.app",
      subject: "Komisioni u aprovua",
      text: "Komisioni prej 9000.00 u aprovua.",
    });

    // Not an error, and not a silent pretence either: the message is logged.
    expect(result.delivered).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain("rep@radx.app");
  });

  it("reuses one transport per process, and rebuilds it on demand", () => {
    const first = transport();
    expect(transport()).toBe(first);
    resetTransport();
    expect(transport()).not.toBe(first);
  });
});

describe("mailer with SMTP configured", () => {
  it("sends through the configured host", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    resetTransport();

    const sendMailSpy = vi.fn(async () => ({ messageId: "1" }));
    vi.spyOn(transport(), "sendMail").mockImplementation(sendMailSpy as never);

    const result = await sendMail({ to: "rep@radx.app", subject: "Test", text: "Përshëndetje" });
    expect(result.delivered).toBe(true);
    expect(sendMailSpy).toHaveBeenCalledTimes(1);
  });
});

describe("links inside an email", () => {
  it("makes the path absolute against AUTH_URL", () => {
    expect(bodyWithLink("Kontrata skadon.", "/contracts/k1")).toBe(
      "Kontrata skadon.\n\nhttps://crm.radx.app/contracts/k1\n",
    );
  });

  it("does not double the slash when AUTH_URL has a trailing one", () => {
    process.env.AUTH_URL = "https://crm.radx.app/";
    expect(bodyWithLink("x", "/commissions")).toContain("https://crm.radx.app/commissions");
  });
});
