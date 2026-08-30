# PayProof technical architecture

## System boundary

PayProof is a client-side React application plus one generic Sui Move module. There is no application server, card-data handler, private order database, or privileged payment operator in this release.

```text
Order form + wallet
        |
        | one programmable transaction
        v
payproof::pay<T> -----> Coin<T> to SME
        |
        +-------------> PaymentReceipt<T> to payer
        |
        +-------------> PaymentRecorded<T> event

Receipt JSON --local SHA-256--> pinned event + transaction lookup
```

## On-chain contract

`contracts/payproof/sources/payproof.move` exposes `pay<T>` for any Sui coin type. It rejects zero amounts, non-32-byte commitments, empty order references, and references over 128 UTF-8 bytes. In one transaction it:

1. reads the payment coin value and transaction sender;
2. reads the system clock;
3. creates a typed, payer-owned receipt object;
4. emits a typed event with the same facts;
5. transfers the payment coin to the recipient; and
6. transfers the receipt to the payer.

Move transaction atomicity means an abort rolls back every step. The module never holds funds and has no admin withdrawal path.

## Private receipt commitment

The downloadable receipt contains structured order data and a cryptographically random 128-bit `commitmentNonce`. PayProof canonicalizes the complete payload, including the nonce, then hashes it with browser Web Crypto SHA-256. Only the 32-byte digest, order reference, payer, recipient, amount, asset type through the generic event, receipt ID, and timestamp become public.

The nonce matters: hashing a predictable invoice without it can permit offline guessing. It is not encryption—the receipt file itself contains the order and must be handled as a business document—but it makes the public commitment hiding against simple dictionary attacks.

## Frontend and network client

- React 19 + TypeScript + Vite.
- Current `@mysten/dapp-kit-react` wallet integration.
- `SuiGrpcClient` on testnet; legacy JSON-RPC is not used. Mysten’s current migration guidance recommends the gRPC client: [JSON-RPC migration](https://sdk.mystenlabs.com/sui/migrations/sui-2.0/json-rpc-migration).
- `Transaction.coin({ balance, type })` resolves an exact SUI or USDC payment coin while preserving a separate gas coin when required. The implementation follows Mysten’s current transaction/coin model: [Sui SDK](https://sdk.mystenlabs.com/sui).
- The package ID and canonical Circle USDC type are pinned in source, with an environment override for controlled redeployments.

## Transaction state machine

```text
edit -> review -> wallet signing -> submitted/indexing -> success
  ^        |             |                 |
  |        +-- edit -----+                 +-- retry lookup only
  |                      |
  +---- validation/rejection/failed tx ----+
```

The submitted digest is retained before indexing begins. This prevents a temporary indexing failure from exposing another “Pay” action and causing a duplicate payment. Balance queries are required to succeed before review, wallet rejection is distinguished from insufficient funds, and successful completion invalidates cached balances.

## Verification trust model

The verifier does not trust arbitrary JSON. It validates the complete receipt schema, arithmetic, field limits, Sui addresses, transaction digest, asset/coin pairing, amount units, commitment nonce, network, and known package ID. It recalculates the local commitment and then requires one exact `PaymentRecorded<coinType>` event whose receipt ID, payer, recipient, amount, order commitment, order reference, and timestamp all match.

This package pin prevents a malicious file from pointing at a lookalike contract. Event bytes accept the Base64 representation returned by current Sui gRPC as well as byte arrays used in isolated tests.

## Asset and card decisions

- SUI uses `0x2::sui::SUI` with 9 decimals.
- USDC uses Circle’s canonical Sui testnet type `0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC` with 6 decimals: [Circle Sui quickstart](https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui).
- USDC settlement follows the USD order total exactly. SUI uses the separately agreed SUI amount because the app does not embed a price oracle.
- Card acquisition belongs to a regulated mainnet on-ramp provider. Testnet uses faucets; the app never collects PAN, CVV, or cardholder data.

## Limits and future work

- Browser local storage is convenience history, not durable accounting storage; the JSON download is the portable record.
- A production deployment should add organization authentication, encrypted/managed receipt storage, backups, observability, a dedicated Sui node provider, and legal/compliance review.
- Mainnet requires a separately published and audited package, mainnet USDC pinning, production RPC, card/on-ramp contracts, and operational key management.
- Escrow, milestones, delivery proofs, disputes, and partial releases require new stateful contracts and independent threat modeling.
