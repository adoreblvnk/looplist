import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { baseSepolia } from "wagmi/chains";

export const BASE_SEPOLIA_CHAIN_ID = baseSepolia.id;
export const BASE_SEPOLIA_NETWORK = "eip155:84532" as const;
// x402 exact requires eth_signTypedData_v4, which newly provisioned Base Accounts
// currently reject on Base Sepolia. Coinbase Wallet's EOA mobile flow supports it.
export const COINBASE_WALLET_PREFERENCE = { options: "eoaOnly" } as const;

export const walletConfig = createConfig({
  chains: [baseSepolia],
  connectors: [
    coinbaseWallet({
      appName: "LoopList",
      preference: COINBASE_WALLET_PREFERENCE,
    }),
    injected(),
  ],
  transports: { [baseSepolia.id]: http("https://sepolia.base.org") },
  ssr: true,
});
