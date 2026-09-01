# ProofPay UI Prototype

Standalone frontend prototype for ProofPay, a delivery-linked B2B order and settlement experience.

## Included

- Premium animated landing page
- Unified buyer and supplier workspace
- Operational order register with buyer/supplier filters
- Purchase-order creation and supplier confirmation flows
- Shared order records with partial-settlement progress
- Wallet actions and B2C QR payment interface
- Connected trade console: Google/Supabase session, Sui wallet connection, buyer order creation, one-time supplier invite, funding proof, delivery, evidence dispute, AI mediation, partial release, and Sui settlement receipt
- Responsive layouts and reduced-motion accessibility support

## Run locally

```bash
cd ui-prototype
npm install
npm run dev
```

Open http://localhost:3000.

The sign-in surface presents the identity model explicitly: Continue with Google → real Sui zkLogin → PayProof account plus Sui address for signing; More sign-in options → connect an existing Sui wallet → PayProof account using that verified address. The current Google button calls Supabase OAuth and the wallet alternative uses Sui dApp Kit. A production zkLogin deployment still needs a configured Google OIDC client, zkLogin prover, salt policy, and callback allowlist. The console calls the backend at `NEXT_PUBLIC_PAYPROOF_BACKEND_URL` (default `http://localhost:8787`). Copy the public Supabase URL and publishable key into `.env.local` to enable the Google OAuth path. If OAuth is not configured, the backend's explicitly labelled demo identities remain available when `PAYPROOF_DEMO_MODE=true`.

Card top-up is intentionally simulated for the hackathon presentation. Escrow funding, dispute opening, party approvals, undisputed release, and settlement execution require a connected Sui testnet wallet and are independently checked by the backend against the deployed escrow package. Evidence text and AI debate stay off-chain; the final receipt and escrow lifecycle stay on Sui.
