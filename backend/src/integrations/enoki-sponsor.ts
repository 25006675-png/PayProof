import { DomainError } from "../domain/types.js";

/** The escrow entry functions a sponsored transaction is allowed to call. Anything else is
 *  refused, so the sponsor cannot be used as a general purpose faucet. */
const ESCROW_ENTRY_FUNCTIONS = [
  "create",
  "create_with_milestones",
  "mark_shipped",
  "mark_shipped_and_release",
  "anchor_evidence",
  "open_dispute",
  "release_full",
  "refund_unshipped",
  "claim_uninspected",
  "approve_buyer",
  "approve_supplier",
  "approve_arbitrator",
  "execute_settlement",
] as const;

/** Enoki holds the sponsor keypair and pays the gas from the app's allowance, so no funded
 *  private key lives in this service. */
export class EnokiSponsor {
  private readonly allowedMoveCallTargets: string[];

  constructor(
    private readonly apiKey: string,
    private readonly network: string,
    packageId: string,
    legacyPackageIds: string[] = [],
    private readonly baseUrl = "https://api.enoki.mystenlabs.com/v1",
  ) {
    const escrowPackages = [packageId, ...legacyPackageIds];
    this.allowedMoveCallTargets = [
      ...escrowPackages.flatMap((id) => ESCROW_ENTRY_FUNCTIONS.map((name) => `${id}::escrow::${name}`)),
      // Direct payment with an on-chain receipt, used by the wallet's pay-by-QR flow.
      `${packageId}::payproof::pay`,
    ];
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new DomainError("SPONSOR_UNAVAILABLE", "The gas sponsor is unreachable", 502);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 400).trim();
      console.error(`Enoki sponsor ${response.status} on ${path}: ${detail || "(empty body)"}`);
      throw new DomainError(
        "SPONSOR_FAILED",
        `The gas sponsor refused this transaction (${response.status})${detail ? `: ${detail}` : ""}`,
        502,
      );
    }
    return (await response.json() as { data: T }).data;
  }

  /** Enoki dry runs the transaction to size the gas budget, so an impossible call fails here
   *  with a readable reason instead of costing anything. */
  async sponsor(input: { transactionKindBytes: string; sender: string }) {
    return this.call<{ bytes: string; digest: string }>("/transaction-blocks/sponsor", {
      transactionBlockKindBytes: input.transactionKindBytes,
      network: this.network,
      sender: input.sender,
      allowedMoveCallTargets: this.allowedMoveCallTargets,
      allowedAddresses: [input.sender],
    });
  }

  async execute(digest: string, signature: string) {
    return this.call<{ digest: string }>(`/transaction-blocks/sponsor/${encodeURIComponent(digest)}`, { signature });
  }
}
