import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const isDevelopment = process.env.NODE_ENV === "development";
const scriptSource = `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`;
const connectSource = "connect-src 'self' https://sepolia.base.org https://rpc.wallet.coinbase.com https://cca-lite.coinbase.com https://www.walletlink.org wss://www.walletlink.org";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    // The Base Account connector is browser-only, but its package exposes a
    // Node entry during Client Component SSR that pulls optional CDP adapters.
    resolveAlias: { "@base-org/account": "@base-org/account/browser" },
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: `default-src 'self'; ${scriptSource}; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; ${connectSource}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};

export default withWorkflow(nextConfig);
