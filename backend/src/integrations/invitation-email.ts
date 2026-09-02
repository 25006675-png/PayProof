import nodemailer, { type Transporter } from "nodemailer";

export type InvitationDelivery = {
  status: "sent" | "failed" | "not_configured";
  messageId?: string;
  attemptedAt: string;
};

export type InvitationEmailInput = {
  invitationId: string;
  to: string;
  orderReference: string;
  buyerName: string;
  supplierName: string;
  reviewUrl: string;
  expiresAt: string;
};

export interface InvitationEmailSender {
  send(input: InvitationEmailInput): Promise<InvitationDelivery>;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character]!);
}

export class DisabledInvitationEmailSender implements InvitationEmailSender {
  async send(): Promise<InvitationDelivery> {
    return { status: "not_configured", attemptedAt: new Date().toISOString() };
  }
}

export class ResendInvitationEmailSender implements InvitationEmailSender {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(input: InvitationEmailInput): Promise<InvitationDelivery> {
    const attemptedAt = new Date().toISOString();
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `order-invite/${input.invitationId}`,
        },
        body: JSON.stringify({
          from: this.from,
          to: [input.to],
          subject: `${input.buyerName} invited you to review ${input.orderReference}`,
          text: `${input.supplierName},\n\n${input.buyerName} invited you to review purchase order ${input.orderReference} in PayProof. Sign in with ${input.to} to review every term before confirming.\n\nReview order: ${input.reviewUrl}\n\nThis invitation expires ${input.expiresAt}. Commercial line items are not included in this email.`,
          html: `<p>${escapeHtml(input.supplierName)},</p><p>${escapeHtml(input.buyerName)} invited you to review purchase order <strong>${escapeHtml(input.orderReference)}</strong> in PayProof.</p><p>Sign in with <strong>${escapeHtml(input.to)}</strong> to review every term before confirming.</p><p><a href="${escapeHtml(input.reviewUrl)}">Review purchase order</a></p><p>This invitation expires ${escapeHtml(input.expiresAt)}. Commercial line items are not included in this email.</p>`,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const payload = await response.json().catch(() => ({})) as { id?: string };
      if (!response.ok || !payload.id) {
        console.error("Invitation email delivery failed", { invitationId: input.invitationId, provider: "resend", status: response.status });
        return { status: "failed", attemptedAt };
      }
      return { status: "sent", messageId: payload.id, attemptedAt };
    } catch (error) {
      console.error("Invitation email delivery failed", {
        invitationId: input.invitationId, provider: "resend",
        reason: error instanceof Error ? error.message : String(error),
      });
      return { status: "failed", attemptedAt };
    }
  }
}

export type SmtpInvitationEmailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

export class SmtpInvitationEmailSender implements InvitationEmailSender {
  private readonly transport: Pick<Transporter, "sendMail">;

  constructor(
    private readonly config: SmtpInvitationEmailConfig,
    transport?: Pick<Transporter, "sendMail">,
  ) {
    this.transport = transport ?? nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async send(input: InvitationEmailInput): Promise<InvitationDelivery> {
    const attemptedAt = new Date().toISOString();
    try {
      const result = await this.transport.sendMail({
        from: this.config.from,
        to: input.to,
        subject: `${input.buyerName} invited you to review ${input.orderReference}`,
        text: `${input.supplierName},\n\n${input.buyerName} invited you to review purchase order ${input.orderReference} in PayProof. Sign in with ${input.to} to review every term before confirming.\n\nReview order: ${input.reviewUrl}\n\nThis invitation expires ${input.expiresAt}. Commercial line items are not included in this email.`,
        html: `<p>${escapeHtml(input.supplierName)},</p><p>${escapeHtml(input.buyerName)} invited you to review purchase order <strong>${escapeHtml(input.orderReference)}</strong> in PayProof.</p><p>Sign in with <strong>${escapeHtml(input.to)}</strong> to review every term before confirming.</p><p><a href="${escapeHtml(input.reviewUrl)}">Review purchase order</a></p><p>This invitation expires ${escapeHtml(input.expiresAt)}. Commercial line items are not included in this email.</p>`,
        headers: { "X-PayProof-Invitation-ID": input.invitationId },
      });
      return { status: "sent", messageId: result.messageId || input.invitationId, attemptedAt };
    } catch (error) {
      // Without this the buyer sees "delivery failed" and nobody can see why.
      console.error("Invitation email delivery failed", {
        invitationId: input.invitationId, host: this.config.host,
        reason: error instanceof Error ? error.message : String(error),
        code: (error as { code?: string }).code,
      });
      return { status: "failed", attemptedAt };
    }
  }
}
