import type { PaymentRequirements } from "@x402/core/types";
import { describe, expect, it } from "vitest";
import {
  BASE_ACCOUNT_PREFERENCE,
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_NETWORK,
  walletConfig,
} from "../components/marketplace/wallet-config";
import {
  selectExactPaymentRequirements,
  selectWalletConnector,
  walletApprovalErrorMessage,
  walletConnectionErrorMessage,
} from "../components/marketplace/wallet-connection";

const requirement: PaymentRequirements = {
  scheme: "exact",
  network: BASE_SEPOLIA_NETWORK,
  asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  amount: "825000000",
  payTo: "0x1111111111111111111111111111111111111111",
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" },
};

const expected = {
  amount: requirement.amount,
  recipient: requirement.payTo,
  asset: requirement.asset,
  network: requirement.network,
};

describe("buyer wallet connection", () => {
  it("configures Base Sepolia with Base Account, Coinbase mobile, and injected connectors", () => {
    expect(BASE_ACCOUNT_PREFERENCE).toEqual({ telemetry: false });
    expect(walletConfig.chains.map((chain) => chain.id)).toEqual([BASE_SEPOLIA_CHAIN_ID]);
    expect(walletConfig.connectors.slice(0, 3).map(({ id, type }) => ({ id, type }))).toEqual([
      { id: "baseAccount", type: "baseAccount" },
      { id: "coinbaseWalletSDK", type: "coinbaseWallet" },
      { id: "injected", type: "injected" },
    ]);
  });

  it("selects the requested official connector without falling through to another wallet", () => {
    const connectors = [
      { id: "baseAccount", type: "baseAccount" },
      { id: "coinbaseWalletSDK", type: "coinbaseWallet" },
      { id: "injected", type: "injected" },
    ];
    expect(selectWalletConnector(connectors, "baseAccount")?.id).toBe("baseAccount");
    expect(selectWalletConnector(connectors, "coinbase")?.id).toBe("coinbaseWalletSDK");
    expect(selectWalletConnector(connectors, "injected")?.id).toBe("injected");
    expect(selectWalletConnector([], "coinbase")).toBeUndefined();
  });

  it("returns actionable errors for cancellation, missing extensions, pop-ups, and connectivity", () => {
    expect(walletConnectionErrorMessage("coinbase", new Error("User closed modal"))).toMatch(/cancelled/i);
    expect(walletConnectionErrorMessage("injected", new Error("Provider not found"))).toMatch(/install or enable/i);
    expect(walletConnectionErrorMessage("coinbase", new Error("Popup blocked"))).toMatch(/allow pop-ups/i);
    expect(walletConnectionErrorMessage("coinbase", new Error("WebSocket network error"))).toMatch(/check your connection/i);
    expect(walletConnectionErrorMessage("baseAccount", new Error("This chain is not supported"))).toMatch(/reconnect with Base Account/i);
    expect(walletApprovalErrorMessage(new Error("Base Sepolia is not supported. Please try a different chain."))).toMatch(/disconnect and reconnect/i);
    expect(walletApprovalErrorMessage(new Error("User denied request"))).toMatch(/no payment was authorized/i);
  });
});

describe("wallet-side x402 policy", () => {
  it("accepts only the exact x402 v2 amount, recipient, asset, and Base Sepolia network", () => {
    expect(selectExactPaymentRequirements(2, [requirement], expected)).toEqual([requirement]);
    expect(selectExactPaymentRequirements(1, [requirement], expected)).toEqual([]);

    for (const mismatch of [
      { amount: "824000000" },
      { payTo: "0x2222222222222222222222222222222222222222" },
      { asset: "0x3333333333333333333333333333333333333333" },
      { network: "eip155:8453" },
      { scheme: "upto" },
    ]) {
      expect(selectExactPaymentRequirements(2, [{ ...requirement, ...mismatch } as PaymentRequirements], expected)).toEqual([]);
    }
  });

  it("matches EVM addresses case-insensitively without relaxing any other term", () => {
    expect(selectExactPaymentRequirements(2, [
      { ...requirement, asset: requirement.asset.toLowerCase(), payTo: requirement.payTo.toUpperCase().replace("0X", "0x") },
    ], expected)).toHaveLength(1);
  });
});
