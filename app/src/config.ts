import { TESTNET_PACKAGE_ID } from "./deployments";

export const NETWORK = "testnet" as const;

export const PAYPROOF_PACKAGE_ID =
  import.meta.env.VITE_PAYPROOF_PACKAGE_ID?.trim() || TESTNET_PACKAGE_ID;

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
