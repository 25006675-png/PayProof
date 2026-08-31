# PayProof

PayProof is a Sui testnet payment application for SMEs: enter a detailed order, settle it atomically in SUI or testnet USDC, download a privacy-preserving receipt, and independently verify the receipt against Sui.

The repository also contains the bounded, cited dispute-mediation backend and a shared-object Sui escrow package. Deliberation, evidence, legal retrieval, and negotiation stay off-chain; only the escrow balance, approvals, and final receipt are settled on-chain. See [backend/README.md](./backend/README.md).

## Live testnet deployment

- Package (v2, escrow + payment): [`0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535`](https://suiscan.xyz/testnet/object/0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535)
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
$env:NODE_OPTIONS='--use-system-ca'
npm run test:sui
```

Current automated coverage: 10 Move cases and the frontend/backend suites. See [simplified_flow.md](./simplified_flow.md), [technical_architecture.md](./technical_architecture.md), [PRODUCT.md](./PRODUCT.md), and [DESIGN.md](./DESIGN.md).

The dispute backend has 51 tests covering authorization, evidence gates, immutable proposals, exact money conservation, deadline boundaries, negotiation caps, AI abstention, citation/evidence-ID validation, arbitration, concurrency, HTTP behavior, focused corpus selection, retrieval from the downloaded Malaysian legal corpus, Sui settlement-proof verification, and escrow-binding replay protection. Live smoke scripts also verify Gemini generation/embeddings, Qdrant writes/queries, a complete two-round mediation/acceptance flow, and the full API-to-testnet settlement route.

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

## Production boundary

This repository is a complete testnet release, not a mainnet custody or card-processing system. Production card top-up should use an approved mainnet on-ramp such as the providers listed by Sui, then return to PayProof’s balance check. Mainnet also requires a separate audited deployment, production RPC, durable receipt storage, monitoring, compliance review, and protected operational keys.

Primary references: [Mysten Sui SDK](https://sdk.mystenlabs.com/sui), [React dApp Kit](https://sdk.mystenlabs.com/dapp-kit/getting-started/react), [Circle Sui USDC quickstart](https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui), and [Sui on-ramp guidance](https://www.sui.io/blog/how-to-get-started-with-sui).
