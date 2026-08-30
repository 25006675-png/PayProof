# PayProof

PayProof is a Sui testnet payment application for SMEs: enter a detailed order, settle it atomically in SUI or testnet USDC, download a privacy-preserving receipt, and independently verify the receipt against Sui.

## Live testnet deployment

- Package: [`0xe736a1c424b9d608b42b2cb09925e537324e6f9f4ca7452d88d822c4c7824263`](https://suiscan.xyz/testnet/object/0xe736a1c424b9d608b42b2cb09925e537324e6f9f4ca7452d88d822c4c7824263)
- Publish transaction: [`HADDGD23v9ULc69C5imbrp9KqLXEB4Y1pW6oP29Jm1Ro`](https://suiscan.xyz/testnet/tx/HADDGD23v9ULc69C5imbrp9KqLXEB4Y1pW6oP29Jm1Ro)
- Executed 0.01 SUI proof payment: [`ANKPvWAu42wM9QgaxVSezK2qSBj24ThUKdmaAJRB8oJu`](https://suiscan.xyz/testnet/tx/ANKPvWAu42wM9QgaxVSezK2qSBj24ThUKdmaAJRB8oJu)
- Created receipt object: [`0x9928ff5e76d21c7ddc430c995fbfdf4ef0fbaae4e040bdc265a0652674bb7e43`](https://suiscan.xyz/testnet/object/0x9928ff5e76d21c7ddc430c995fbfdf4ef0fbaae4e040bdc265a0652674bb7e43)

The real transaction exposed Sui’s Base64 event encoding for `vector<u8>`; the frontend decoder and tests use that actual wire representation.

## Run locally

Requirements: Node.js 20+ and a current Sui CLI.

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
```

Current automated coverage: 6 Move cases and 25 frontend cases. See [simplified_flow.md](./simplified_flow.md), [technical_architecture.md](./technical_architecture.md), [PRODUCT.md](./PRODUCT.md), and [DESIGN.md](./DESIGN.md).

## Repository layout

```text
app/                    React dApp and verification tool
contracts/payproof/     Move package and unit tests
.impeccable/            Design-system sidecar
PRODUCT.md              Product intent and anti-references
DESIGN.md               Normative visual system
```

## Production boundary

This repository is a complete testnet release, not a mainnet custody or card-processing system. Production card top-up should use an approved mainnet on-ramp such as the providers listed by Sui, then return to PayProof’s balance check. Mainnet also requires a separate audited deployment, production RPC, durable receipt storage, monitoring, compliance review, and protected operational keys.

Primary references: [Mysten Sui SDK](https://sdk.mystenlabs.com/sui), [React dApp Kit](https://sdk.mystenlabs.com/dapp-kit/getting-started/react), [Circle Sui USDC quickstart](https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui), and [Sui on-ramp guidance](https://www.sui.io/blog/how-to-get-started-with-sui).
