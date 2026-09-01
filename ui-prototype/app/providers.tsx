"use client";

import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { suiDAppKit } from "@/lib/sui-dapp-kit";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <DAppKitProvider dAppKit={suiDAppKit}>{children}</DAppKitProvider>
    </QueryClientProvider>
  );
}
