import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { baseSepolia } from "wagmi/chains";

export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id;
export const BASE_SEPOLIA_NETWORK = "eip155:84532" as const;

export const walletConfig = createConfig({
  chains: [baseSepolia],
  connectors: [
    coinbaseWallet({
      appName: "LoopList",
      preference: { options: "all" },
    }),
    injected(),
  ],
  transports: { [baseSepolia.id]: http("https://sepolia.base.org") },
  ssr: true,
});
