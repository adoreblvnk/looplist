"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { useState } from "react";
import { walletConfig } from "./wallet-config";

export { walletConfig } from "./wallet-config";

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <WagmiProvider config={walletConfig}><QueryClientProvider client={queryClient}>{children}</QueryClientProvider></WagmiProvider>;
}
