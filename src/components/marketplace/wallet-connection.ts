import type { PaymentRequirements } from "@x402/core/types";
import type { Connector } from "wagmi";

export type WalletChoice = "coinbase" | "injected";
export const PRIMARY_WALLET_CHOICE: WalletChoice = "coinbase";

type SelectableConnector = Pick<Connector, "id" | "type">;

export function selectWalletConnector<T extends SelectableConnector>(
  connectors: readonly T[],
  choice: WalletChoice,
): T | undefined {
  if (choice === "coinbase") {
    return connectors.find((connector) => connector.type === "coinbaseWallet");
  }
  return connectors.find((connector) => connector.id === "injected")
    ?? connectors.find((connector) => connector.type === "injected");
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const details = "shortMessage" in error && typeof error.shortMessage === "string"
      ? error.shortMessage
      : error.message;
    return details.toLowerCase();
  }
  return "";
}

export function walletConnectionErrorMessage(choice: WalletChoice, error: unknown): string {
  const details = errorText(error);

  if (/reject|denied|cancel|closed modal/.test(details)) {
    return "Connection was cancelled. Choose a wallet option when you’re ready to continue.";
  }
  if (/already pending|request pending|resource unavailable/.test(details)) {
    return "A wallet request is already open. Finish or cancel it in the wallet, then try again.";
  }
  if (/popup|pop-up|window/.test(details)) {
    return "The wallet window could not open. Allow pop-ups for LoopList, then try again.";
  }
  if (/network|fetch|websocket|offline/.test(details)) {
    return "The wallet service could not be reached. Check your connection and try again.";
  }
  if (/chain.*not supported|not supported.*chain|unsupported chain|switch.*chain/.test(details)) {
    return "Coinbase Wallet is not connected to Base Sepolia. Enable testnets in the mobile app, select Base Sepolia, then reconnect and try again.";
  }
  if (choice === "injected" && /provider|not found|unavailable|connector/.test(details)) {
    return "No browser wallet extension was found. Install or enable one, unlock it, then try again.";
  }
  if (choice === "coinbase") {
    return "Coinbase Wallet could not connect. Allow pop-ups, scan the mobile QR code again, and select Base Sepolia in the app.";
  }
  return "The browser wallet could not connect. Unlock the extension, refresh the page, and try again.";
}

export function walletApprovalErrorMessage(error: unknown): string {
  const details = errorText(error);
  if (/chain.*not supported|not supported.*chain|unsupported chain|switch.*chain/.test(details)) {
    return "This Coinbase Wallet session cannot approve on Base Sepolia. Disconnect, select Base Sepolia in the mobile app, then scan the QR code again.";
  }
  if (/reject|denied|cancel/.test(details)) {
    return "Wallet approval was cancelled. No payment was authorized.";
  }
  if (error instanceof Error && error.message !== "wallet_not_ready") return error.message;
  return "Wallet authorization was not completed.";
}

export interface ExactPaymentExpectation {
  amount: string;
  recipient: string;
  asset: string;
  network: string;
}

export function selectExactPaymentRequirements(
  version: number,
  requirements: PaymentRequirements[],
  expected: ExactPaymentExpectation,
): PaymentRequirements[] {
  if (version !== 2) return [];
  return requirements.filter((requirement) => (
    requirement.scheme === "exact"
    && requirement.network === expected.network
    && requirement.amount === expected.amount
    && requirement.payTo.toLowerCase() === expected.recipient.toLowerCase()
    && requirement.asset.toLowerCase() === expected.asset.toLowerCase()
  ));
}
