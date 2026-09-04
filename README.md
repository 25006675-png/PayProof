# PayProof

PayProof is a Sui testnet payment application for SMEs: enter a detailed order, settle it atomically in SUI or testnet USDC, download a privacy-preserving receipt, and independently verify the receipt against Sui.

The repository also contains the bounded, cited dispute-mediation backend and a shared-object Sui escrow package. Deliberation, evidence, legal retrieval, and negotiation stay off-chain; only the escrow balance, approvals, and final receipt are settled on-chain. See [backend/README.md](./backend/README.md).

## Live testnet deployment

- Escrow package (v3, current): [`0x132dda3d655724c5a667a4454baef3db3f6529ecf42ddb65132e1d9d14fd6f30`](https://suiscan.xyz/testnet/object/0x132dda3d655724c5a667a4454baef3db3f6529ecf42ddb65132e1d9d14fd6f30)
- v3 publish transaction: [`4KchvvWTCX3r5Q5judJ8bcijBSybF4EvT5kyJ96amLMW`](https://suiscan.xyz/testnet/tx/4KchvvWTCX3r5Q5judJ8bcijBSybF4EvT5kyJ96amLMW)
- v3 upgrade capability (still held by the deployer; make the package immutable before claiming there is no admin path): `0x19f84d3daa4864ab5642739e3619b7c09824e34e6d76957e16ad13e39e4ba3cc`
- v3 is a fresh publish rather than an upgrade because the escrow struct gained deadline fields. It pays the undisputed value inside the buyer's `open_dispute`, anchors evidence hashes, records shipment, and adds `refund_unshipped` and `claim_uninspected` so neither party can stall the other. Escrows created on v2 stay on v2.
- Legacy package (v2, escrow + payment, used by the immediate-payment app in `app/`): [`0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535`](https://suiscan.xyz/testnet/object/0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535)
- Publish transaction: [`HADDGD23v9ULc69C5imbrp9KqLXEB4Y1pW6oP29Jm1Ro`](https://suiscan.xyz/testnet/tx/HADDGD23v9ULc69C5imbrp9KqLXEB4Y1pW6oP29Jm1Ro)
- Escrow upgrade transaction: [`HgPr1R4tAAAymS3SV4VdUoQSw61m17RXnJf5GCihVKqf`](https://suiscan.xyz/testnet/tx/HgPr1R4tAAAymS3SV4VdUoQSw61m17RXnJf5GCihVKqf)
- Executed 0.01 SUI proof payment: [`ANKPvWAu42wM9QgaxVSezK2qSBj24ThUKdmaAJRB8oJu`](https://suiscan.xyz/testnet/tx/ANKPvWAu42wM9QgaxVSezK2qSBj24ThUKdmaAJRB8oJu)
- Created receipt object: [`0x9928ff5e76d21c7ddc430c995fbfdf4ef0fbaae4e040bdc265a0652674bb7e43`](https://suiscan.xyz/testnet/object/0x9928ff5e76d21c7ddc430c995fbfdf4ef0fbaae4e040bdc265a0652674bb7e43)

The real transaction exposed Sui’s Base64 event encoding for `vector<u8>`; the frontend decoder and tests use that actual wire representation.

## Run locally

Requirements: Node.js 20+ for the browser app, Node.js 22+ for the backend
(the Sui gRPC SDK requires it), and a current Sui CLI.

```powershell
cd app
$env:NODE_OPTIONS='--use-system-ca' # only needed on hosts whose Node uses a separate CA store
npm ci
npm run dev
```

Connect a testnet wallet. Use the official Sui and Circle faucet links shown in the UI for valueless test assets. Circle’s public faucet can require a manual reCAPTCHA; this is intentionally not bypassed.

## Verify everything

```powershell
# Move contract and generic coin behavior
& "$env:LOCALAPPDATA\bin\sui.exe" move test --path .\contracts\payproof

# Arithmetic, validation, signing, retry/idempotency, receipt, tampering, and network paths
cd app
npm test

# TypeScript and production bundle
npm run build

# Re-query the executed testnet payment and simulate the current app transaction builder
npm run test:testnet

# Desktop/mobile overflow, labels, console errors, and automated WCAG checks
npm run visual-check

# Dispute backend unit/integration suite and real testnet escrow route
cd ../backend
npm test
npm run build
npm run test:sui
```

Current automated coverage: 20 Move cases, 27 frontend tests, and 99 backend tests. See [simplified_flow.md](./simplified_flow.md), [technical_architecture.md](./technical_architecture.md), [PRODUCT.md](./PRODUCT.md), and [DESIGN.md](./DESIGN.md).

The dispute backend has 60 tests covering authorization, evidence gates, immutable proposals, exact money conservation, deadline boundaries, negotiation caps, AI abstention, citation/evidence-ID validation, bounded citation repair, email-bound invite identity, arbitration, concurrency, HTTP behavior, focused corpus selection, retrieval from the downloaded Malaysian legal corpus, Sui funding/settlement-proof verification, and escrow-binding replay protection. Live smoke scripts also verify Gemini generation/embeddings, Qdrant writes/queries, a complete two-round mediation/acceptance flow, and the full API-to-testnet settlement route.

## Repository layout

```text
app/                    React dApp and verification tool
contracts/payproof/     Move package and unit tests
backend/                Dispute API, legal RAG, AI orchestrator, and tests
supabase/               Database/RLS/storage migration
docs/                   Downloaded legal source files and RAG corpus
.impeccable/            Design-system sidecar
PRODUCT.md              Product intent and anti-references
DESIGN.md               Normative visual system
```

## Connected trade flow

The `/workspace` route now contains the end-to-end trade console. A buyer creates an order with line items and delivery terms, shares a single-use hashed invite, and the supplier accepts it from another session. The buyer's wallet creates the shared Sui escrow; the backend rereads the `EscrowCreated` transaction before recording funding. The supplier signs shipment on the escrow, and every document attached after funding has its SHA-256 anchored on-chain in the same or a separate transaction. After delivery, a buyer claim pays the accepted value to the supplier inside the claim transaction itself and opens the bounded legal-RAG mediation flow for the disputed remainder; both parties approve the same allocation, and the backend verifies the final Sui receipt before marking the case settled. Two deadline paths need no counterparty: the buyer reclaims an escrow that was never shipped by the delivery deadline, and the supplier claims an escrow the buyer neither accepted nor disputed inside the seven-day inspection window.

The sign-in surface presents the intended identity model: Google → real Sui zkLogin → PayProof account plus a Sui address for signing, with an alternate existing-wallet path that creates the account from its verified address. The current Google button is wired to Supabase OAuth and the wallet path uses Sui dApp Kit; a production zkLogin deployment additionally needs a Google OIDC client, zkLogin prover, salt policy, and callback allowlist. Google identity and card top-up are visibly simulated only when the demo route is used. Do not put a Supabase secret/service-role key in the browser. Apply `supabase/migrations/202609010001_trade_orders.sql` and set `BACKEND_STORE=supabase` for durable order aggregates.

## Production boundary

This repository is a complete testnet release, not a mainnet custody or card-processing system. Production card top-up should use an approved mainnet on-ramp such as the providers listed by Sui, then return to PayProof’s balance check. Mainnet also requires a separate audited deployment, production RPC, durable receipt storage, monitoring, compliance review, and protected operational keys.

Primary references: [Mysten Sui SDK](https://sdk.mystenlabs.com/sui), [React dApp Kit](https://sdk.mystenlabs.com/dapp-kit/getting-started/react), [Circle Sui USDC quickstart](https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui), and [Sui on-ramp guidance](https://www.sui.io/blog/how-to-get-started-with-sui).
