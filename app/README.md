# PayProof web app

The React client creates SUI/USDC order payments, downloads receipts, and verifies them against the pinned testnet Move package.

```powershell
npm ci
npm run dev
npm test
npm run build
npm run visual-check
```

`VITE_PAYPROOF_PACKAGE_ID` may override the checked-in testnet deployment for controlled testing. Receipt verification deliberately rejects files from any package other than the configured package.
