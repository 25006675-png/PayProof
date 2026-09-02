"use client";

import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

const GRPC_URLS = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
};

export const suiDAppKit = createDAppKit({
  enableBurnerWallet: process.env.NODE_ENV !== "production",
  slushWalletConfig: null,
  networks: ["mainnet", "testnet", "devnet"],
  defaultNetwork: "testnet",
  createClient(network) {
    return new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] });
  },
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof suiDAppKit;
  }
}

export const ESCROW_PACKAGE_ID =
  process.env.NEXT_PUBLIC_PAYPROOF_PACKAGE_ID?.trim() ||
  "0x4e1f7a3e99809622e2adbc379967eae7d7c26375378558594528810deddd6535";

export const TESTNET_USDC_TYPE =
  "0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC";

export const SUI_TYPE = "0x2::sui::SUI";

/** Arbitrator wallet written into every escrow. Set NEXT_PUBLIC_DEFAULT_ARBITRATOR_ADDRESS to the real arbitrator address. */
export const DEFAULT_ARBITRATOR_ADDRESS =
  process.env.NEXT_PUBLIC_DEFAULT_ARBITRATOR_ADDRESS?.trim() || `0x${"c".repeat(64)}`;

export const explorerTransactionUrl = (digest: string) =>
  `https://suiscan.xyz/testnet/tx/${digest}`;

export const explorerObjectUrl = (objectId: string) =>
  `https://suiscan.xyz/testnet/object/${objectId}`;
