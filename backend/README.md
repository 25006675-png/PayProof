# PayProof dispute backend

This service implements the off-chain dispute, negotiation, legal-RAG, and arbitration-package workflow. It deliberately does **not** claim to execute escrow: the currently deployed Move package pays the recipient immediately. Settlement allocations are instructions for a future audited escrow package.

## Implemented flow

```text
buyer claim + evidence
        |
supplier agrees --------------------------> settlement instruction
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
designated arbitrator instruction --------------> settlement instruction
```

The AI uses two advocates and one neutral mediator/critic. The orchestrator permits at most two internal debate rounds and five model calls. It stops after one round when positions converge. `abstain` is a valid result when evidence or verified authority is inadequate.

## Safety invariants

- Buyer, supplier, and arbitrator identities must be distinct.
- Only the buyer opens a claim and only the supplier performs supplier review.
- Supplier disagreement requires counter-evidence before negotiation opens.
- Every allocation uses integer asset units and must exactly equal the disputed balance.
- The undisputed balance is separated immediately; current execution status remains `pending_on_chain_escrow`.
- One proposal can be open at a time. AI proposals have no implicit acceptance.
- A human proposal is accepted initially only by its proposer; both parties must accept to settle.
- Rejection after the last round and exact deadline expiry both escalate.
- During pending arbitration, independently matching party positions settle early.
- Only the designated arbitrator can issue a final instruction.
- Evidence and contract content are treated as untrusted data, not model instructions.
- AI citations must resolve to retrieved corpus passage IDs; invented citations and unbalanced arithmetic are rejected.
- Aggregate writes use optimistic versions to prevent lost updates.

## Local commands

```powershell
cd backend
npm ci
npm test
npm run build
npm run check:services
npm start
```

On a Windows host where Node does not automatically trust the system certificate store, prefix network commands with:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
```

## Configuration and deployment

The repository-root `.env` is ignored by Git. `.env.example` documents all variables.

The supplied publishable Supabase key is sufficient for browser/API authentication checks, but it cannot apply migrations or perform trusted backend writes. The supplied Gemini credential has now passed structured generation, single/batch embedding, focused legal-corpus ingestion, and a live two-round mediation. Remote Supabase deployment still requires:

1. `SUPABASE_SECRET_KEY` (`sb_secret_...`) for the server, never the browser.
2. A Supabase access token or dashboard SQL access to apply `supabase/migrations/202608310001_disputes.sql`.
3. The configured `GEMINI_API_KEY` to be installed as a protected production secret rather than copied into frontend variables.

The long JWT supplied with the Qdrant endpoint authenticates successfully as the Qdrant API key; it is not a Gemini key.

Live validation commands:

```powershell
npm run test:gemini
npm run ingest:legal
npm run test:qdrant
npm run test:mediation
```

The focused ingestion selects 25 directly relevant passages from 150 verified chunks. The live mediation smoke test completed two deliberation rounds and five model calls, returned verified corpus citations, conserved the full disputed balance through deterministic backend arithmetic, and completed independent acceptance by both parties.

## Legal corpus

`docs/corpus/manifest.json` pins each document, source URL, checksum, and verification caveat. The corpus currently contains:

- Sale of Goods Act 1957 (Act 382), including conformity, quality/fitness, inspection, acceptance, and damages provisions.
- Contracts Act 1950 (Act 136), including compensation provisions.
- *Puncak Niaga (M) Sdn Bhd v NZ Wheels Sdn Bhd*, Court of Appeal grounds concerning defective goods and rejection.

The statute PDFs are 2006 reprints. Their later amendment status must be rechecked by Malaysian counsel before production use. The selected judgment is a complete court document hosted by a secondary mirror and must be verified against an official law report before production reliance. AI output is always non-binding and is not legal advice.

## Current evidence-file boundary

The migration creates a private 20 MB evidence bucket and the domain stores SHA-256, MIME type, size, and storage path. The current mediation input uses party evidence statements and file metadata. PDF/image extraction, malware scanning, signed cross-party access, and multimodal Gemini review must be added before accepting production evidence files; the API does not pretend those files were substantively reviewed yet.
