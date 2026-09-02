import { afterEach, describe, expect, it, vi } from "vitest";
import { DisabledInvitationEmailSender, ResendInvitationEmailSender, SmtpInvitationEmailSender } from "../src/integrations/invitation-email.js";

const input = {
  invitationId: "invite-1", to: "supplier@example.com", orderReference: "PO-42",
  buyerName: "GreenBite Trading", supplierName: "FreshSource Foods",
  reviewUrl: "http://localhost:3000/orders/order-1?invite=secret", expiresAt: "2026-09-09T00:00:00.000Z",
};

describe("invitation email delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports missing configuration without pretending an email was sent", async () => {
    await expect(new DisabledInvitationEmailSender().send()).resolves.toMatchObject({ status: "not_configured" });
  });

  it("sends only invitation metadata with an idempotency key", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
    vi.stubGlobal("fetch", request);
    const result = await new ResendInvitationEmailSender("re_test", "PayProof <orders@example.com>").send(input);
    expect(result).toMatchObject({ status: "sent", messageId: "email-1" });
    const [url, init] = request.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("idempotency-key")).toBe("order-invite/invite-1");
    const payload = JSON.parse(String(init.body));
    expect(payload.text).toContain("PO-42");
    expect(payload.text).not.toContain("Premium cooking oils");
  });

  it("reports provider failure without throwing away the order flow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "rejected" }), { status: 422 })));
    await expect(new ResendInvitationEmailSender("re_test", "PayProof <orders@example.com>").send(input))
      .resolves.toMatchObject({ status: "failed" });
  });

  it("sends invitation metadata through authenticated SMTP", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "smtp-email-1" });
    const sender = new SmtpInvitationEmailSender({
      host: "smtp.gmail.com", port: 465, secure: true,
      user: "payproof@example.com", password: "app-password",
      from: "PayProof <payproof@example.com>",
    }, { sendMail } as never);

    await expect(sender.send(input)).resolves.toMatchObject({ status: "sent", messageId: "smtp-email-1" });
    expect(sendMail).toHaveBeenCalledOnce();
    const message = sendMail.mock.calls[0]?.[0];
    expect(message.to).toBe("supplier@example.com");
    expect(message.subject).toContain("PO-42");
    expect(message.headers["X-PayProof-Invitation-ID"]).toBe("invite-1");
    expect(message.text).not.toContain("Premium cooking oils");
  });
});
