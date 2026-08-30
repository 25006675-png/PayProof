import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64, normalizeStructTag } from "@mysten/sui/utils";

const PACKAGE_ID =
  process.env.PAYPROOF_PACKAGE_ID ??
  "0xe736a1c424b9d608b42b2cb09925e537324e6f9f4ca7452d88d822c4c7824263";
const PAYMENT_DIGEST =
  process.env.PAYPROOF_PAYMENT_DIGEST ??
  "ANKPvWAu42wM9QgaxVSezK2qSBj24ThUKdmaAJRB8oJu";
const RECEIPT_ID =
  "0x9928ff5e76d21c7ddc430c995fbfdf4ef0fbaae4e040bdc265a0652674bb7e43";
const PAYER =
  "0x97244cf38ff9fd4da3cd8a64723d0733e446f58363a6ead150813f08b7dabc65";
const RECIPIENT = `0x${"b".repeat(64)}`;
const SUI_TYPE = "0x2::sui::SUI";

const client = new SuiGrpcClient({
  network: "testnet",
  baseUrl: "https://fullnode.testnet.sui.io:443",
});

async function retry(action, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

const recorded = await retry(() =>
  client.getTransaction({ digest: PAYMENT_DIGEST, include: { events: true, effects: true } }),
);
if (recorded.FailedTransaction) {
  throw new Error(`Recorded payment failed: ${recorded.FailedTransaction.status.error?.message}`);
}

const expectedType = normalizeStructTag(
  `${PACKAGE_ID}::payproof::PaymentRecorded<${SUI_TYPE}>`,
);
const recordedEvent = recorded.Transaction.events?.find(
  (event) => normalizeStructTag(event.eventType) === expectedType,
);
if (!recordedEvent) throw new Error("Recorded PaymentRecorded<SUI> event is missing.");

const facts = recordedEvent.json ?? {};
const expectedHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const actualHash = fromBase64(String(facts.order_hash ?? ""));
if (
  facts.receipt_id !== RECEIPT_ID ||
  facts.payer !== PAYER ||
  facts.recipient !== RECIPIENT ||
  String(facts.amount) !== "10000000" ||
  facts.order_reference !== "PAYPROOF-E2E-2026" ||
  actualHash.length !== expectedHash.length ||
  actualHash.some((byte, index) => byte !== expectedHash[index])
) {
  throw new Error("Recorded payment facts do not match the expected receipt.");
}

const receipt = await retry(() => client.getObject({ objectId: RECEIPT_ID }));
if (receipt.FailedObject) throw new Error("The payer-owned receipt object is not available.");

const transaction = new Transaction();
transaction.setSender(PAYER);
const payment = transaction.coin({ balance: 1_000_000n, type: SUI_TYPE });
transaction.moveCall({
  target: `${PACKAGE_ID}::payproof::pay`,
  typeArguments: [SUI_TYPE],
  arguments: [
    payment,
    transaction.pure.address(RECIPIENT),
    transaction.pure.vector("u8", Array(32).fill(7)),
    transaction.pure.string("APP-BUILDER-LIVE-SIM"),
    transaction.object.clock(),
  ],
});

const simulated = await retry(() =>
  client.simulateTransaction({ transaction, include: { events: true, effects: true } }),
);
if (simulated.FailedTransaction) {
  throw new Error(
    `App transaction simulation failed: ${simulated.FailedTransaction.status.error?.message}`,
  );
}
const simulatedEvent = simulated.Transaction.events?.find(
  (event) => normalizeStructTag(event.eventType) === expectedType,
);
if (!simulatedEvent || simulatedEvent.json?.order_reference !== "APP-BUILDER-LIVE-SIM") {
  throw new Error("The app transaction builder did not produce the expected event.");
}

console.log("Testnet package, executed SUI payment, receipt object, and app builder: verified.");
console.log(`Package: ${PACKAGE_ID}`);
console.log(`Payment: ${PAYMENT_DIGEST}`);
console.log(`Receipt: ${RECEIPT_ID}`);
