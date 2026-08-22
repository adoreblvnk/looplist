/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { useCallback, useEffect, useRef, useState } from "react";
import { useConnect, useConnection, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import type { CheckoutSnapshot } from "./types";
import { displayPrice, humanize } from "./utils";
import { BASE_SEPOLIA_CHAIN_ID, BASE_SEPOLIA_NETWORK } from "./wallet-config";
import {
  PRIMARY_WALLET_CHOICE,
  selectExactPaymentRequirements,
  selectWalletConnector,
  walletApprovalErrorMessage,
  walletConnectionErrorMessage,
  type WalletChoice,
} from "./wallet-connection";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Checkout({ listingId }: { listingId: string }) {
  const [checkout, setCheckout] = useState<CheckoutSnapshot | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [connectingChoice, setConnectingChoice] = useState<WalletChoice | null>(null);
  const pollCount = useRef(0);
  const connection = useConnection();
  const { connectAsync, connectors } = useConnect();
  const { disconnect, disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient({ chainId: BASE_SEPOLIA_CHAIN_ID });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/purchases/${encodeURIComponent(listingId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("checkout_unavailable");
      setCheckout(await response.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, [listingId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (checkout?.status !== "settlement_pending") {
      pollCount.current = 0;
      return;
    }
    const timer = window.setInterval(() => {
      pollCount.current += 1;
      if (pollCount.current >= 40) {
        window.clearInterval(timer);
        setMessage("Receipt reconciliation is taking longer than expected. Reload to check again.");
        return;
      }
      void load();
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [checkout?.status, load]);

  function openWalletModal() {
    setWalletError("");
    setWalletModalOpen(true);
  }

  async function connectWallet(choice: WalletChoice) {
    setWalletError("");
    const connector = selectWalletConnector(connectors, choice);
    if (!connector) {
      setWalletError(choice === "coinbase"
        ? "Base / Coinbase is unavailable in this browser. Refresh the page and try again."
        : "No browser wallet extension was found. Install or enable one, then try again.");
      return;
    }
    setConnectingChoice(choice);
    try {
      const result = await connectAsync({ connector, chainId: BASE_SEPOLIA_CHAIN_ID });
      if (result.chainId !== BASE_SEPOLIA_CHAIN_ID) {
        await disconnectAsync({ connector });
        setWalletError("That wallet connected on a different network. Select Base Sepolia in Coinbase Wallet mobile, then scan the QR code again.");
        return;
      }
      setWalletModalOpen(false);
    } catch (error) {
      setWalletError(walletConnectionErrorMessage(choice, error));
    } finally {
      setConnectingChoice(null);
    }
  }

  async function approve() {
    if (!checkout || !connection.address) return;
    setBusy(true);
    setMessage("");
    try {
      if (connection.chainId !== BASE_SEPOLIA_CHAIN_ID) {
        await switchChainAsync({ chainId: BASE_SEPOLIA_CHAIN_ID });
      }
      if (!walletClient) throw new Error("wallet_not_ready");

      const expected = {
        amount: checkout.amount.atomicAmount,
        recipient: checkout.recipientAddress,
        asset: checkout.asset,
        network: BASE_SEPOLIA_NETWORK,
      };
      const signer = {
        address: connection.address,
        signTypedData: async (args: {
          domain: Record<string, unknown>;
          types: Record<string, unknown>;
          primaryType: string;
          message: Record<string, unknown>;
        }) => walletClient.signTypedData({ account: connection.address, ...args } as never),
      };
      const client = new x402Client()
        .register(BASE_SEPOLIA_NETWORK, new ExactEvmScheme(signer))
        .setSpendControls({ maxAmountPerPayment: false })
        .registerPolicy((version, requirements) => (
          selectExactPaymentRequirements(version, requirements, expected)
        ));
      const response = await wrapFetchWithPayment(fetch, client)(
        `/api/purchases/${encodeURIComponent(listingId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ buyerAddress: connection.address, approved: true }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok && response.status !== 202) {
        throw new Error(body?.error?.message ?? "Payment could not be completed.");
      }
      setMessage(response.status === 202
        ? "Payment confirmed. Preparing your receipt…"
        : "Purchase complete.");
      await load();
    } catch (error) {
      setMessage(walletApprovalErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function reconcile() {
    setBusy(true);
    try {
      const response = await fetch(`/api/purchases/${encodeURIComponent(listingId)}/reconcile`, { method: "POST" });
      if (!response.ok) throw new Error("reconciliation_unavailable");
      setMessage("Receipt reconciliation restarted.");
      await load();
    } catch {
      setMessage("Receipt reconciliation is still unavailable. Your settlement reference remains preserved.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return <section className="checkout-panel" aria-labelledby="checkout-title"><h2 id="checkout-title">Purchase</h2><p>Checkout is unavailable right now.</p><button className="button secondary" onClick={load}>Try again</button></section>;
  }
  if (!checkout) {
    return <section className="checkout-panel" aria-busy="true"><div className="skeleton line"/><div className="skeleton line short"/></section>;
  }
  if (checkout.status === "sold" && checkout.receipt) return <ReceiptView receipt={checkout.receipt}/>;

  return (
    <section className="checkout-panel" aria-labelledby="checkout-title">
      <div className="checkout-heading"><div><p className="eyebrow">Protected checkout</p><h2 id="checkout-title">Review and purchase</h2></div><span className={`commerce-status ${checkout.status}`}>{humanize(checkout.status)}</span></div>
      <dl className="approval-facts"><div><dt>Listing</dt><dd>{checkout.title}</dd></div><div><dt>Total</dt><dd>{displayPrice(checkout.amount)}</dd></div><div><dt>Condition</dt><dd>{humanize(checkout.condition)} · {checkout.conditionSummary}</dd></div><div><dt>Recipient</dt><dd className="mono break">{checkout.recipientAddress}</dd></div><div><dt>Payment network</dt><dd>Base Sepolia · test USDC</dd></div></dl>
      {checkout.status === "reconciliation_failed"
        ? <button className="button" disabled={busy} onClick={reconcile}>Retry receipt reconciliation</button>
        : checkout.status === "settlement_pending"
          ? <p className="pending-copy" role="status">Payment settled. We’re durably recording the sold listing and receipt.</p>
          : connection.status !== "connected"
            ? <button className="button" onClick={openWalletModal}>Connect buyer wallet</button>
            : <div className="wallet-approval"><p>Connected as <span className="mono">{short(connection.address)}</span>{connection.chainId !== BASE_SEPOLIA_CHAIN_ID && " · switch to Base Sepolia to continue"}</p><div className="button-row"><button className="button" disabled={busy} onClick={approve}>{busy ? "Waiting for approval…" : `Approve ${displayPrice(checkout.amount)}`}</button><button className="button secondary" onClick={() => disconnect()}>Disconnect</button></div></div>}
      <p className="checkout-note">Nothing is authorized until you press approve and confirm the exact terms in your wallet. LoopList never receives or stores your private keys.</p>
      {message && <p className="form-message" role="status">{message}</p>}
      {walletModalOpen && <WalletChoiceModal connectingChoice={connectingChoice} error={walletError} onChoose={connectWallet} onClose={() => setWalletModalOpen(false)}/>}
    </section>
  );
}

function WalletChoiceModal({ connectingChoice, error, onChoose, onClose }: {
  connectingChoice: WalletChoice | null;
  error: string;
  onChoose: (choice: WalletChoice) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const primaryOption = useRef<HTMLButtonElement>(null);
  const connecting = connectingChoice !== null;

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      primaryOption.current?.focus();
    }
    return () => { if (element?.open) element.close(); };
  }, []);

  return (
    <dialog ref={dialog} className="wallet-dialog" aria-labelledby="wallet-dialog-title" aria-describedby="wallet-dialog-description" onCancel={(event) => { event.preventDefault(); if (!connecting) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !connecting) onClose(); }}>
      <div className="wallet-dialog-card">
        <div className="wallet-dialog-heading">
          <div><p className="eyebrow">Buyer wallet</p><h2 id="wallet-dialog-title">Choose how to connect</h2></div>
          <button className="wallet-dialog-close" type="button" aria-label="Close wallet choices" disabled={connecting} onClick={onClose}>×</button>
        </div>
        <p id="wallet-dialog-description">Connect on Base Sepolia to approve the exact test USDC payment.</p>
        <div className="wallet-options">
          <button ref={primaryOption} className="wallet-option primary" type="button" disabled={connecting} onClick={() => onChoose(PRIMARY_WALLET_CHOICE)}>
            <span className="wallet-option-mark base-mark" aria-hidden="true">B</span>
            <span><strong>{connectingChoice === "coinbase" ? "Opening Coinbase Wallet QR…" : "Continue with Coinbase Wallet"}</strong><small>Scan with Coinbase Wallet mobile on Base Sepolia. No browser extension required.</small><em>Recommended</em></span>
          </button>
          <button className="wallet-option" type="button" disabled={connecting} onClick={() => onChoose("injected")}>
            <span className="wallet-option-mark" aria-hidden="true">↗</span>
            <span><strong>{connectingChoice === "injected" ? "Opening browser wallet…" : "Browser wallet extension"}</strong><small>Use an existing injected wallet already installed and unlocked in this browser.</small></span>
          </button>
        </div>
        {error && <p className="wallet-error" role="alert">{error}</p>}
        <p className="wallet-privacy">Your wallet keeps custody of its keys. LoopList only requests the signatures required for this approved testnet payment.</p>
      </div>
    </dialog>
  );
}

function ReceiptView({ receipt }: { receipt: NonNullable<CheckoutSnapshot["receipt"]> }) {
  return <section className="receipt" aria-labelledby="receipt-title"><div className="receipt-mark" aria-hidden="true">✓</div><p className="eyebrow">Purchase complete</p><h2 id="receipt-title">Settlement receipt</h2><p>{receipt.listingTitle} is sold to {receipt.buyer.displayName}.</p><dl className="approval-facts"><div><dt>Paid</dt><dd>{displayPrice(receipt.amount)}</dd></div><div><dt>Seller</dt><dd>{receipt.seller.displayName}</dd></div><div><dt>Recipient</dt><dd className="mono break">{receipt.recipientAddress}</dd></div><div><dt>Network</dt><dd>Base Sepolia</dd></div><div><dt>Payment reference</dt><dd className="mono break">{receipt.x402PaymentReference}</dd></div><div><dt>Settlement</dt><dd><a href={`https://sepolia.basescan.org/tx/${receipt.settlementTransaction}`} target="_blank" rel="noreferrer" className="mono">View on BaseScan ↗</a></dd></div><div><dt>Settled</dt><dd>{new Date(receipt.settledAt).toLocaleString()}</dd></div></dl></section>;
}
