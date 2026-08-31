import {
  isValidSuiAddress,
  normalizeSuiAddress,
  normalizeStructTag,
} from "@mysten/sui/utils";
import { TESTNET_PACKAGE_ID } from "./deployments";

export const NETWORK = "testnet" as const;

export const PAYPROOF_PACKAGE_ID =
  import.meta.env.VITE_PAYPROOF_PACKAGE_ID?.trim() || TESTNET_PACKAGE_ID;

// Sui preserves a module's original type origin when a package is upgraded.
// The legacy `payproof` module therefore keeps this package ID in event and
// receipt object types even when calls are made through PAYPROOF_PACKAGE_ID.
// Keep this explicit and allowlisted rather than accepting arbitrary packages.
export const PAYPROOF_TYPE_ORIGIN_PACKAGE_ID =
  import.meta.env.VITE_PAYPROOF_TYPE_ORIGIN_PACKAGE_ID?.trim() ||
  "0xe736a1c424b9d608b42b2cb09925e537324e6f9f4ca7452d88d822c4c7824263";

export const PAYPROOF_TRUSTED_PACKAGE_IDS = [
  PAYPROOF_PACKAGE_ID,
  PAYPROOF_TYPE_ORIGIN_PACKAGE_ID,
].filter((id, index, all) => all.indexOf(id) === index);

export function isTrustedPayProofPackageId(packageId: string): boolean {
  return (
    isValidSuiAddress(packageId) &&
    PAYPROOF_TRUSTED_PACKAGE_IDS.some(
      (trusted) => normalizeSuiAddress(packageId) === normalizeSuiAddress(trusted),
    )
  );
}

export function isPayProofPaymentRecordedType(
  eventType: string,
  coinType: string,
): boolean {
  if (!eventType || !coinType) return false;
  try {
    const normalized = normalizeStructTag(eventType);
    return PAYPROOF_TRUSTED_PACKAGE_IDS.some(
      (packageId) =>
        normalized ===
        normalizeStructTag(`${packageId}::payproof::PaymentRecorded<${coinType}>`),
    );
  } catch {
    return false;
  }
}

export const SUI_TYPE = "0x2::sui::SUI";
export const TESTNET_USDC_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

export type AssetSymbol = "SUI" | "USDC";

export const ASSETS = {
  SUI: {
    symbol: "SUI",
    name: "Sui",
    decimals: 9,
    coinType: SUI_TYPE,
    faucetUrl: "https://faucet.sui.io/",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    coinType: TESTNET_USDC_TYPE,
    faucetUrl: "https://faucet.circle.com/",
  },
} as const;

export const explorerTransactionUrl = (digest: string) =>
  `https://suiscan.xyz/testnet/tx/${digest}`;

export const explorerObjectUrl = (objectId: string) =>
  `https://suiscan.xyz/testnet/object/${objectId}`;
