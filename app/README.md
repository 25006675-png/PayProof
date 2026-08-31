# PayProof web app

The React client creates SUI/USDC order payments, downloads receipts, and verifies them against the pinned testnet Move package.

```powershell
npm ci
npm run dev
npm test
npm run build
npm run visual-check
```

`VITE_PAYPROOF_PACKAGE_ID` may override the checked-in testnet deployment for controlled testing. Receipt verification only trusts the configured deployment and the original type-origin package retained by Sui for upgraded `payproof` datatypes; arbitrary lookalike packages are rejected.
