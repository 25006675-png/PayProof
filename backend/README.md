# PayProof dispute backend

This service implements the off-chain dispute, negotiation, legal-RAG, and arbitration-package workflow. The version-2 Move deployment also provides a shared-object escrow: deliberation remains off-chain, while funding, approvals, allocation conservation, and the final receipt are enforced on Sui.

## Implemented flow

```text
buyer claim + evidence
        |
supplier agrees --------------------------> settlement agreement (pending Sui)
        |
supplier counter-evidence
        |
verified legal RAG + bounded AI mediation
        |
immutable AI/human proposal
        |
accept | reject | counter (maximum 3 human rounds)
        |
deadline/round limit ---------------------> arbitration package
                                                |
matching early positions <---------------------+
                                                |
designated arbitrator instruction --------------> settlement agreement (pending Sui)
                                                         |
trusted Sui effect verifier ----------------------------> settled receipt
```

The AI uses two advocates and one neutral mediator/critic. The orchestrator permits at most two internal debate rounds and eight model calls, including bounded citation-repair retries. It stops after one round when positions converge. `abstain` is a valid result when evidence or verified authority is inadequate. Final agent records contain structured outputs, exact evidence/legal quotes, labelled inferences, and neutral open questions—not hidden chain-of-thought.

The trade API wraps this state machine with order creation, line-item terms, hashed seven-day supplier invites, supplier wallet binding, Sui funding verification, shipment/delivery checkpoints, undisputed-balance release, and order-status synchronization. See the `/v1/orders`, `/v1/invites/:token/accept`, and `/v1/orders/:id/undisputed-release` routes in `src/api/app.ts`.

## Safety invariants

- Buyer, supplier, and arbitrator identities must be distinct.
- Only the buyer opens a claim and only the supplier performs supplier review.
- Supplier disagreement requires counter-evidence before negotiation opens.
- AI money fields explicitly mean `buyerRefundUnits` and `supplierReleaseUnits`; both are required and must exactly equal the disputed balance. The refund cannot exceed the buyer's requested remedy.
- The undisputed balance is separated immediately; current execution status remains `pending_on_chain_escrow`.
- One proposal can be open at a time. AI proposals have no implicit acceptance.
- A human proposal is accepted initially only by its proposer; both parties must accept to settle.
- Rejection after the last round and exact deadline expiry both escalate.
- During pending arbitration, independently matching party positions settle early.
- Only the designated arbitrator can issue a final instruction.
- Evidence and contract content are treated as untrusted data, not model instructions.
- AI evidence and legal quotes must occur in the referenced source text. Unknown IDs, fabricated quotes, unsupported allocations, and unbalanced arithmetic produce a recorded safety abstention rather than an open proposal.
- Human agreement creates `settlement_pending`. Only a trusted Sui verifier port can record transaction effects and advance the dispute to `settled`.
- Aggregate writes use optimistic versions to prevent lost updates.
- A bound Sui escrow object can back only one dispute; the Supabase partial unique index and memory-store check prevent settlement replay across aggregates.

## Local commands

Use Node.js 22+ for the backend because the Sui gRPC SDK targets that runtime.

```powershell
cd backend
npm ci
npm test
npm run build
npm run check:services
npm start
```

The backend start/dev and live-network npm scripts enable Node's system certificate store automatically. For a one-off direct `tsx` invocation on a Windows host where Node does not automatically trust the system certificate store, use:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
```

## Configuration and deployment

The repository-root `.env` is ignored by Git. `.env.example` documents all variables.

The supplied publishable Supabase key is sufficient for browser/API authentication checks, but it cannot apply migrations or perform trusted backend writes. The supplied Gemini credential has now passed structured generation, single/batch embedding, focused legal-corpus ingestion, and a live two-round mediation. Remote Supabase deployment still requires:

1. `SUPABASE_SECRET_KEY` (`sb_secret_...`) for the server, never the browser.
2. A Supabase access token or dashboard SQL access to apply the existing dispute migrations plus `supabase/migrations/202609010001_trade_orders.sql`.
3. The configured `GEMINI_API_KEY` to be installed as a protected production secret rather than copied into frontend variables.

The long JWT supplied with the Qdrant endpoint authenticates successfully as the Qdrant API key; it is not a Gemini key.

Live validation commands:

```powershell
npm run test:gemini
npm run ingest:legal
npm run test:qdrant
npm run test:mediation
npm run test:sui
```

The focused ingestion selects 25 source-balanced, substantive passages from 150 verified chunks. Synchronization reuses unchanged content-hash IDs, embeds missing passages first, and deletes stale points only after successful upsert. The live mediation smoke test returned an explicit 6,000-unit buyer refund plus 24,000-unit supplier release, exact evidence/legal quotes, labelled inferences, and independently persisted party/mediator finals. The isolated suite currently contains 60 passing tests, including Sui funding/settlement gRPC verifier tests, invite replay protection, email-bound invite identity, direct supplier agreement, citation-repair regression, and escrow-binding replay protection.

## Demo progression API

Set `PAYPROOF_DEMO_MODE=true` only in a demo environment. Authenticated routes expose one mutable hero order and read-only background orders:

- `GET /v1/demo/orders`
- `POST /v1/demo/orders/reset`
- `POST /v1/demo/orders/:id/advance`

Every transition returns an `executionKind`: `live_backend`, `live_ai_reference`, `simulated_wait`, `seeded_demo_data`, or `external_sui_reference`. Shipping/deadline waits may be fast-forwarded, but escrow funding, a live mediation result, and Sui settlement require external references. Both human acceptances stop at `awaiting_sui_settlement`; the harness never labels that agreement as executed funds.

## Current Sui boundary

`POST /v1/orders/:id/funding` independently re-reads the buyer's `EscrowCreated` event before recording a funded order. `POST /v1/orders/:id/undisputed-release` performs the same check for the supplier's `UndisputedReleased` event. `POST /v1/disputes/:id/settlement-execution` is enabled when `SUI_ESCROW_VERIFIER_ENABLED=true`; the server then uses the read-only gRPC verifier to re-read the funding, dispute, and settlement transactions plus the final shared receipt. It confirms the configured package, bound escrow and parties, exact disputed allocation, deleted escrow, created receipt, receipt provenance, and (for new agreements) the SHA-256 proposal/agreement hash; a client-supplied digest alone is never accepted. Disputes opened without `onchainEscrow` remain deliberately ineligible for execution confirmation.

The deployed package is `0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535` (testnet, version 2). Set `SUI_ESCROW_PACKAGE_ID` to another audited deployment before using a different network. `onchainEscrow` in the opening request must contain the package/object IDs, funding and dispute transaction digests, and the three wallet addresses; the verifier checks all of them against Sui events.

`npm run test:sui` runs the complete API flow against the pinned public testnet
escrow: open dispute, supplier counter-evidence, human proposal and both
acceptances, then real gRPC verification of the finalized settlement receipt.
Override the `SUI_LIVE_*` variables when testing another fixture. The script is
read-only with respect to Sui; it never signs or submits a transaction.

## Legal corpus

`docs/corpus/manifest.json` pins each document, source URL, checksum, and verification caveat. The corpus currently contains:

- Sale of Goods Act 1957 (Act 382), including conformity, quality/fitness, inspection, acceptance, and damages provisions.
- Contracts Act 1950 (Act 136), including compensation provisions.
- *Puncak Niaga (M) Sdn Bhd v NZ Wheels Sdn Bhd*, Court of Appeal grounds concerning defective goods and rejection.

The statute PDFs are 2006 reprints. Their later amendment status must be rechecked by Malaysian counsel before production use. The selected judgment is a complete court document hosted by a secondary mirror and must be verified against an official law report before production reliance. AI output is always non-binding and is not legal advice.

## Current evidence-file boundary

The migration creates a private 20 MB evidence bucket and the domain stores SHA-256, MIME type, size, and storage path. The current mediation input uses party evidence statements and file metadata. PDF/image extraction, malware scanning, signed cross-party access, and multimodal Gemini review must be added before accepting production evidence files; the API does not pretend those files were substantively reviewed yet.
