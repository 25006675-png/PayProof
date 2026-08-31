# PayProof flow

## Current testnet release

1. The payer connects a Sui-compatible wallet.
2. They enter the order or invoice number, SME recipient address, customer name, line items, discount, tax, and notes.
3. They choose settlement in SUI or the canonical Sui testnet USDC.
4. If funds are missing, testnet links lead to the Sui or Circle faucet. Card on-ramping is intentionally a mainnet concern because testnet assets have no financial value.
5. PayProof validates the order, exact asset amount, wallet balance, recipient, package deployment, and all input bounds.
6. The payer reviews the full order and payment endpoints before the wallet opens.
7. One Sui programmable transaction transfers the selected coin and creates a payer-owned `PaymentReceipt<T>` while emitting `PaymentRecorded<T>`. Both happen or neither happens.
8. The browser waits for the indexed event. If indexing times out after submission, PayProof keeps the digest and offers “Retry receipt check”; it never presents a second pay action.
9. A successful receipt contains the detailed private order, a fresh 128-bit commitment nonce, payment facts, the on-chain receipt object, and transaction digest. The chain stores only the resulting SHA-256 commitment and essential payment facts.
10. Anyone with the receipt file can independently recalculate the commitment locally and match the pinned package, network, asset type, amount, payer, recipient, order reference, timestamp, and receipt object against Sui testnet.

## Failure and recovery paths

- A rejected wallet request returns to review and explicitly confirms that no funds moved.
- A failed Sui transaction clears the pending state and can safely be retried.
- A submitted transaction with a delayed RPC/indexer response cannot be paid twice from the UI; only receipt lookup is retryable.
- A malformed, altered, wrong-network, wrong-package, wrong-asset, or internally inconsistent receipt is rejected before or during chain verification.
- Testnet faucet throttling or CAPTCHA requirements do not weaken payment logic; they only affect how a test wallet acquires valueless assets.

## Why the first release is immediate settlement

The earlier concept included supplier invitations, delivery tracking, escrow, inspections, partial release, disputes, and AI document/photo review. Those are valuable later phases, but combining them with first settlement would add identity, custody, notification, oracle, dispute-governance, and compliance surfaces before the core payment proof is validated.

The immediate-payment path still proves one narrow promise well: **pay the order and keep independently verifiable proof immediately**. The dispute extension is a separate escrow contract family and backend workflow, not hidden inside this direct-payment function. Escrow funding, partial release, evidence, negotiation, and arbitration therefore have their own identity, custody, deadline, and threat-model boundaries.

## Dispute and escrow extension

1. A buyer opens a claim with a structured statement and evidence metadata; the supplier can agree or submit counter-evidence.
2. Once both sides have evidence, bounded Gemini advocates and a neutral mediator retrieve curated Malaysian legal passages from Qdrant and produce one cited, non-binding proposal. Intermediate agent reasoning is not persisted.
3. Humans may accept, reject, or counter a proposal for a bounded number of rounds. A fixed deadline closes negotiation; unresolved cases become an arbitration package. Matching independent positions can settle early.
4. A human agreement or arbitrator instruction becomes `settlement_pending`; it never implies that funds moved. The client submits wallet-signed escrow transactions, and the backend accepts a settlement digest only after its configured Sui gRPC verifier confirms package, parties, events, conservation, escrow deletion, and receipt provenance.

## External integration boundary

- Sui lists MoonPay, Transak, Banxa, and Coinbase Pay as fiat on-ramp processors; availability varies by country. A production card button should open a contracted provider on mainnet, then return to the same balance check rather than processing card data inside PayProof: [Sui on-ramp guidance](https://www.sui.io/blog/how-to-get-started-with-sui).
- Circle states that Sui testnet USDC has no financial value and identifies its canonical coin type. The app pins that exact type: [Circle USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses).
- Testnet SUI comes from the official faucet; public endpoints are rate-limited: [Mysten TypeScript SDK network and faucet guide](https://sdk.mystenlabs.com/sui).
