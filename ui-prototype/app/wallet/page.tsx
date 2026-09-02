"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Bitcoin, Check, ClipboardCopy, Clock3, CreditCard, Landmark, LockKeyhole, Plus, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AppShell, HelpHint, Notice, PageTitle } from "@/app/components/app-shell";
import { formatOrderMoney as money } from "@/lib/demo-orders";
import { suiDAppKit, SUI_TYPE } from "@/lib/sui-dapp-kit";
import { useWorkspace } from "@/lib/use-workspace";
import { AnimatedAmount, LiftCard } from "@/app/components/motion";

type Movement = { id: string; type: "in" | "out"; title: string; detail: string; amount: number; at: string; state: "pending" | "complete" };
type Method = "card" | "bank" | "crypto";

const MOVEMENTS_KEY = "payproof_wallet_movements";
const BANKS = ["Maybank", "CIMB Bank", "Public Bank", "RHB Bank", "Hong Leong Bank", "AmBank", "Bank Islam", "OCBC Malaysia"];

function loadMovements(accountKey: string): Movement[] {
  try { return JSON.parse(localStorage.getItem(`${MOVEMENTS_KEY}:${accountKey}`) ?? "[]") as Movement[]; } catch { return []; }
}
function saveMovements(accountKey: string, movements: Movement[]) {
  localStorage.setItem(`${MOVEMENTS_KEY}:${accountKey}`, JSON.stringify(movements));
}

export default function WalletPage() {
  const workspace = useWorkspace();
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceNote, setBalanceNote] = useState("");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const address = workspace.session?.suiAddress ?? "";

  const readBalance = useCallback(async () => {
    if (!address) return null;
    const result = await suiDAppKit.getClient("testnet").getBalance({ owner: address, coinType: SUI_TYPE });
    return Number(result.balance.balance) / 1_000_000_000;
  }, [address]);

  useEffect(() => {
    if (!workspace.ready) return;
    setMovements(loadMovements(workspace.accountKey));
    if (!address) { setBalance(null); setBalanceNote(workspace.live ? "Sign in with Google zkLogin or connect a Sui wallet to load the on-chain balance." : "Sign in to load your balance."); return; }
    readBalance()
      .then((value) => { setBalance(value); setBalanceNote("Balance read from Sui Testnet."); })
      .catch((cause) => setBalanceNote(cause instanceof Error ? `The balance could not be read: ${cause.message}` : "The balance could not be read."));
  }, [workspace.ready, workspace.accountKey, workspace.live, address, readBalance]);

  /** Asks the Sui testnet faucet for SUI and waits for the coin to become visible, returning what arrived. */
  const requestFaucet = async () => {
    const before = (await readBalance()) ?? 0;
    const response = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The faucet did not respond.");
    let after = before;
    for (let attempt = 0; attempt < 12 && after <= before; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      after = (await readBalance().catch(() => before)) ?? before;
    }
    setBalance(after);
    setBalanceNote("Balance read from Sui Testnet.");
    return Math.max(0, after - before);
  };

  const position = useMemo(() => {
    const funded = (role: "BUYER" | "SUPPLIER") => workspace.orders.filter((order) => order.role === role && ["funded", "in_transit", "delivered", "dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending"].includes(order.status));
    const buying = funded("BUYER");
    const supplying = funded("SUPPLIER");
    const held = workspace.orders.filter((order) => order.inspection && order.inspection.heldValue > 0 && !["settled", "cancelled"].includes(order.status));
    const pendingIn = movements.filter((item) => item.state === "pending" && item.type === "in").reduce((sum, item) => sum + item.amount, 0);
    const pendingOut = movements.filter((item) => item.state === "pending" && item.type === "out").reduce((sum, item) => sum + item.amount, 0);
    return {
      buying: { value: buying.reduce((sum, order) => sum + order.value, 0), count: buying.length },
      supplying: { value: supplying.reduce((sum, order) => sum + order.value, 0), count: supplying.length },
      held: { value: held.reduce((sum, order) => sum + (order.inspection?.heldValue ?? 0), 0), count: held.length },
      pendingIn, pendingOut,
    };
  }, [workspace.orders, movements]);

  const record = (movement: Movement) => {
    const next = [movement, ...movements];
    setMovements(next);
    saveMovements(workspace.accountKey, next);
  };

  return (
    <AppShell active="wallet" company={workspace.company}>
      <PageTitle title="Wallet" description="Money you can spend or withdraw, kept separate from funds secured inside purchase orders." />
      {notice && <Notice tone="success" onDismiss={() => setNotice("")}>{notice}</Notice>}

      <section className="wallet-grid">
        <LiftCard as="article" className="wallet-card" tilt={2} lift={2}>
          <div className="wallet-card-head">
            <span>Available balance<HelpHint text="SUI held at your Sui address. Escrowed funds are not included because the escrow contract holds them, not your address." /></span>
            <span className="wallet-network"><i aria-hidden="true" />Sui Testnet</span>
          </div>
          <strong className="wallet-amount">{balance === null ? <span className="wallet-amount-text">Not connected</span> : <><AnimatedAmount value={balance} decimals={2} /> <small>SUI</small></>}</strong>
          <p className="wallet-address">{address ? <><code>{address.slice(0, 10)}...{address.slice(-8)}</code><button type="button" className="text-button text-button-light" onClick={() => void navigator.clipboard.writeText(address)}><ClipboardCopy size={12} aria-hidden="true" />Copy address</button></> : balanceNote}</p>
          {address && balanceNote && <p className="wallet-note">{balanceNote}</p>}
          <div className="wallet-actions">
            <button type="button" onClick={() => setTopUpOpen(true)}><span><Plus size={17} aria-hidden="true" /></span><strong>Top up</strong><small>Card, bank or crypto</small></button>
            <button type="button" onClick={() => setWithdrawOpen(true)}><span><ArrowUpRight size={17} aria-hidden="true" /></span><strong>Withdraw</strong><small>To bank or Sui address</small></button>
            <button type="button" onClick={() => setQrOpen(true)}><span><QrCode size={17} aria-hidden="true" /></span><strong>Payment QR</strong><small>Collect from a customer</small></button>
          </div>
        </LiftCard>

        <article className="panel money-ledger" aria-labelledby="position-title">
          <div className="panel-head"><h2 id="position-title">Where your money is</h2></div>
          <dl className="money-rows">
            <div><dt>Available to spend</dt>{balance === null ? <dd className="text">Not connected</dd> : <dd>{money(balance)} SUI</dd>}</div>
            {position.pendingIn > 0 && <div className="money-row-pending"><dt><Clock3 size={13} aria-hidden="true" />Top-ups in progress</dt><dd>{money(position.pendingIn)} SUI</dd></div>}
            {position.pendingOut > 0 && <div className="money-row-pending"><dt><Clock3 size={13} aria-hidden="true" />Withdrawals in progress</dt><dd>{money(position.pendingOut)} SUI</dd></div>}
            <div><dt><LockKeyhole size={13} aria-hidden="true" />Secured for your purchases<small>{position.buying.count} {position.buying.count === 1 ? "order" : "orders"}</small></dt><dd>{money(position.buying.value)} SUI</dd></div>
            <div><dt><LockKeyhole size={13} aria-hidden="true" />Secured for your sales<small>{position.supplying.count} {position.supplying.count === 1 ? "order" : "orders"}</small></dt><dd>{money(position.supplying.value)} SUI</dd></div>
            {position.held.count > 0 && <div><dt>Held for open claims<small>{position.held.count} {position.held.count === 1 ? "claim" : "claims"}</small></dt><dd>{money(position.held.value)} SUI</dd></div>}
          </dl>
          <p className="money-foot"><ShieldCheck size={14} aria-hidden="true" />Secured funds are held by the Sui escrow contract. Wallet actions cannot move them.</p>
          <a className="panel-link" href="/orders">Open orders<ArrowRight size={13} aria-hidden="true" /></a>
        </article>
      </section>

      <section className="panel" aria-labelledby="activity-title">
        <div className="panel-head"><h2 id="activity-title">Activity</h2></div>
        {movements.length === 0 ? (
          <p className="panel-empty">No wallet movements yet. Top-ups, withdrawals and released settlements will appear here.</p>
        ) : (
          <ul className="movement-list">
            {movements.map((item) => (
              <li key={item.id}>
                <span className={`movement-icon movement-${item.type}`}>{item.type === "in" ? <ArrowDownLeft size={15} aria-hidden="true" /> : <ArrowUpRight size={15} aria-hidden="true" />}</span>
                <div><strong>{item.title}</strong><small>{item.detail}. {new Date(item.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div>
                <span className={`pill ${item.state === "pending" ? "pill-attention" : "pill-success"}`}>{item.state === "pending" ? "Pending" : "Complete"}</span>
                <strong className={`num ${item.type === "in" ? "amount-in" : ""}`}>{item.type === "in" ? "+" : "-"}{money(item.amount)} SUI</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TopUpDialog open={topUpOpen} onOpenChange={setTopUpOpen} address={address} company={workspace.company} onFaucet={requestFaucet}
        onSubmitted={(movement) => { record(movement); setNotice(movement.state === "complete" ? `${money(movement.amount)} SUI arrived at your address. You can fund escrow with it now.` : "Your top-up was submitted. It shows as pending until the funds arrive at your Sui address."); }} />
      <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} available={balance ?? 0} onSubmitted={(movement) => { record(movement); setNotice("Your withdrawal request was submitted and is pending review."); }} />
      <PaymentQrDialog open={qrOpen} onOpenChange={setQrOpen} company={workspace.company} address={address} />
    </AppShell>
  );
}

function TopUpDialog({ open, onOpenChange, address, company, onFaucet, onSubmitted }: { open: boolean; onOpenChange: (open: boolean) => void; address: string; company: string; onFaucet: () => Promise<number>; onSubmitted: (movement: Movement) => void }) {
  const [step, setStep] = useState<"amount" | "details" | "processing" | "done">("amount");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("card");
  const [card, setCard] = useState({ name: "", number: "", expiry: "", cvc: "" });
  const [bank, setBank] = useState(BANKS[0]);
  const [agreed, setAgreed] = useState(false);
  const [faucetError, setFaucetError] = useState("");
  const [received, setReceived] = useState(0);
  const value = Number(amount);
  const validAmount = Number.isFinite(value) && value >= 0.1;
  const cardValid = card.name.trim().length > 2 && /^\d{16}$/.test(card.number.replace(/\s/g, "")) && /^\d{2}\/\d{2}$/.test(card.expiry) && /^\d{3,4}$/.test(card.cvc);
  const close = (next: boolean) => { if (!next) { setStep("amount"); setAmount(""); setAgreed(false); setCard({ name: "", number: "", expiry: "", cvc: "" }); } onOpenChange(next); };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFaucetError("");
    setStep("processing");
    if (method === "crypto") {
      onFaucet()
        .then((amount) => {
          setReceived(amount);
          onSubmitted({ id: crypto.randomUUID(), type: "in", title: "Testnet faucet", detail: "Sui testnet faucet", amount, at: new Date().toISOString(), state: "complete" });
          setStep("done");
        })
        .catch((cause) => { setFaucetError(cause instanceof Error ? cause.message : "The faucet did not respond."); setStep("details"); });
      return;
    }
    window.setTimeout(() => {
      onSubmitted({ id: crypto.randomUUID(), type: "in", title: "Top-up", detail: method === "card" ? `Card ending ${card.number.slice(-4)}` : method === "bank" ? `Bank transfer from ${bank}` : "SUI transfer on Sui", amount: value, at: new Date().toISOString(), state: "pending" });
      setStep("done");
    }, 1400);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="money-dialog">
        {step === "done" ? (
          <>
            <span className="order-created-mark"><Check size={22} aria-hidden="true" /></span>
            <DialogHeader><DialogTitle>{method === "crypto" ? "Testnet SUI received" : "Top-up submitted"}</DialogTitle><DialogDescription>{method === "crypto"
              ? `${money(received)} SUI arrived at your Sui address and is spendable now. Open an order and fund escrow to use it.`
              : `${money(value)} SUI is on its way to your wallet. Card and bank top-ups usually settle within a few minutes. This demo does not move real funds.`}</DialogDescription></DialogHeader>
            <DialogFooter><Button className="btn-primary" onClick={() => close(false)}>Done</Button></DialogFooter>
          </>
        ) : step === "processing" ? (
          <div className="processing"><RefreshCw size={22} className="spin" aria-hidden="true" /><strong>{method === "crypto" ? "Asking the Sui testnet faucet" : "Processing your top-up"}</strong><span>{method === "crypto" ? "This takes a few seconds while the coin is confirmed." : "Do not close this window."}</span></div>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Top up wallet</DialogTitle>
              <DialogDescription>Add SUI to your available balance. Top-ups never fund a purchase order directly. You fund escrow from the order page.</DialogDescription>
            </DialogHeader>
            {step === "amount" ? (
              <>
                <label className="field"><span>Amount</span><div className="amount-input"><Input autoFocus type="number" min="0.1" step="0.01" placeholder="1.00" value={amount} onChange={(event) => setAmount(event.target.value)} /><b>SUI</b></div><small>Minimum 0.1 SUI.</small></label>
                <div className="method-list" role="radiogroup" aria-label="Payment method">
                  {([
                    { id: "card", icon: CreditCard, title: "Debit or credit card", detail: "Visa or Mastercard. Arrives in minutes. 1.5% processing fee." },
                    { id: "bank", icon: Landmark, title: "Bank transfer (FPX)", detail: "Malaysian online banking. Arrives within one business hour. No fee." },
                    { id: "crypto", icon: Bitcoin, title: "Sui testnet faucet", detail: "Free testnet SUI sent straight to your address. This is the only option that moves real funds." },
                  ] as const).map((option) => (
                    <label key={option.id} className={method === option.id ? "method method-active" : "method"}>
                      <input type="radio" name="method" value={option.id} checked={method === option.id} onChange={() => setMethod(option.id)} />
                      <option.icon size={18} aria-hidden="true" />
                      <span><strong>{option.title}</strong><small>{option.detail}</small></span>
                    </label>
                  ))}
                </div>
                <DialogFooter><Button variant="outline" type="button" onClick={() => close(false)}>Cancel</Button><Button className="btn-primary" type="button" disabled={!validAmount} onClick={() => setStep("details")}>Continue<ArrowRight size={14} aria-hidden="true" /></Button></DialogFooter>
              </>
            ) : (
              <>
                {method !== "crypto" && <div className="summary-strip"><span>Top-up amount</span><strong>{money(value)} SUI</strong><button type="button" className="text-button" onClick={() => setStep("amount")}>Change</button></div>}
                {method === "card" && (
                  <div className="form-grid">
                    <label className="field field-wide"><span>Name on card</span><Input autoComplete="cc-name" value={card.name} onChange={(event) => setCard({ ...card, name: event.target.value })} placeholder={company} /></label>
                    <label className="field field-wide"><span>Card number</span><Input inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={(event) => setCard({ ...card, number: event.target.value.replace(/[^\d ]/g, "").slice(0, 19) })} placeholder="4242 4242 4242 4242" /></label>
                    <label className="field"><span>Expiry</span><Input inputMode="numeric" autoComplete="cc-exp" value={card.expiry} onChange={(event) => setCard({ ...card, expiry: event.target.value })} placeholder="MM/YY" /></label>
                    <label className="field"><span>Security code</span><Input inputMode="numeric" autoComplete="cc-csc" value={card.cvc} onChange={(event) => setCard({ ...card, cvc: event.target.value.replace(/\D/g, "").slice(0, 4) })} placeholder="123" /></label>
                  </div>
                )}
                {method === "bank" && (
                  <label className="field"><span>Your bank</span><select className="select" value={bank} onChange={(event) => setBank(event.target.value)}>{BANKS.map((name) => <option key={name}>{name}</option>)}</select><small>You will be taken to {bank} online banking to approve the transfer, then returned here.</small></label>
                )}
                {method === "crypto" && (
                  <div className="crypto-transfer">
                    <div className="crypto-qr">{address ? <QRCodeSVG value={address} size={132} bgColor="#ffffff" fgColor="#0d1d30" level="M" marginSize={1} /> : <span>Sign in to show your address</span>}</div>
                    <div>
                      <strong>The faucet sends testnet SUI to</strong>
                      <code>{address || "No Sui address in this session"}</code>
                      {address && <button type="button" className="text-button" onClick={() => void navigator.clipboard.writeText(address)}><ClipboardCopy size={12} aria-hidden="true" />Copy address</button>}
                      <small>The faucet grants a fixed amount and is rate limited per client, so it can refuse if this machine asked recently. You can also send SUI to this address yourself.</small>
                    </div>
                  </div>
                )}
                {faucetError && <p className="form-error" role="alert">{faucetError}</p>}
                {method !== "crypto" && <label className="consent-check"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>I confirm the funds come from {company}&apos;s own account and I accept the Terms of Service for wallet top-ups.</span></label>}
                <DialogFooter><Button variant="outline" type="button" onClick={() => setStep("amount")}>Back</Button><Button className="btn-primary" type="submit" disabled={(method !== "crypto" && !agreed) || (method === "card" && !cardValid) || (method === "crypto" && !address)}>{method === "card" ? `Pay ${money(value * 1.015)} SUI` : method === "bank" ? `Continue to ${bank}` : "Request testnet SUI"}</Button></DialogFooter>
              </>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WithdrawDialog({ open, onOpenChange, available, onSubmitted }: { open: boolean; onOpenChange: (open: boolean) => void; available: number; onSubmitted: (movement: Movement) => void }) {
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState<"bank" | "sui">("bank");
  const [account, setAccount] = useState("");
  const [agreed, setAgreed] = useState(false);
  const value = Number(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= available && account.trim().length > 6 && agreed;
  const close = (next: boolean) => { if (!next) { setAmount(""); setAccount(""); setAgreed(false); } onOpenChange(next); };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="money-dialog">
        <form onSubmit={(event) => { event.preventDefault(); onSubmitted({ id: crypto.randomUUID(), type: "out", title: "Withdrawal", detail: destination === "bank" ? `To bank account ending ${account.slice(-4)}` : `To Sui address ${account.slice(0, 6)}...${account.slice(-4)}`, amount: value, at: new Date().toISOString(), state: "pending" }); close(false); }}>
          <DialogHeader><DialogTitle>Withdraw</DialogTitle><DialogDescription>Only the available balance can be withdrawn. Funds secured in purchase orders stay in escrow.</DialogDescription></DialogHeader>
          <label className="field"><span>Amount</span><div className="amount-input"><Input autoFocus type="number" min="1" max={available} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1,000.00" /><b>SUI</b></div><small>{money(available)} SUI available.</small></label>
          <div className="segmented" role="radiogroup" aria-label="Destination">
            <button type="button" className={destination === "bank" ? "segment segment-active" : "segment"} onClick={() => setDestination("bank")}>Bank account</button>
            <button type="button" className={destination === "sui" ? "segment segment-active" : "segment"} onClick={() => setDestination("sui")}>Sui address</button>
          </div>
          <label className="field"><span>{destination === "bank" ? "Account number" : "Sui address"}</span><Input value={account} onChange={(event) => setAccount(event.target.value)} placeholder={destination === "bank" ? "Business account in your company name" : "0x..."} /></label>
          <label className="consent-check"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>The destination belongs to my company. I understand withdrawals are reviewed and cannot be reversed once sent.</span></label>
          <DialogFooter><Button variant="outline" type="button" onClick={() => close(false)}>Cancel</Button><Button className="btn-primary" type="submit" disabled={!valid}>Request withdrawal</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PaymentQrDialog({ open, onOpenChange, company, address }: { open: boolean; onOpenChange: (open: boolean) => void; company: string; address: string }) {
  const [amount, setAmount] = useState("320.00");
  const [reference, setReference] = useState("Walk-in sale");
  const [seconds, setSeconds] = useState(30);
  const [sessionId, setSessionId] = useState(1842);
  useEffect(() => {
    if (!open) return;
    setSeconds(30);
    const timer = window.setInterval(() => setSeconds((current) => { if (current <= 1) { setSessionId((id) => id + 1); return 30; } return current - 1; }), 1000);
    return () => window.clearInterval(timer);
  }, [open]);
  const payload = useMemo(() => JSON.stringify({ network: "sui:testnet", to: address || "unknown", merchant: company, amount: amount || "0.00", currency: "SUI", reference: reference || "Sale", session: `PP-${sessionId}` }), [address, company, amount, reference, sessionId]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="money-dialog qr-dialog">
        <DialogHeader><DialogTitle>Customer payment QR</DialogTitle><DialogDescription>The customer scans this code to pay {company} in SUI. The amount and recipient are fixed in the request, and the code renews every 30 seconds so it cannot be reused.</DialogDescription></DialogHeader>
        <div className="qr-grid">
          <div>
            <label className="field"><span>Amount</span><div className="amount-input"><Input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /><b>SUI</b></div></label>
            <label className="field"><span>Reference</span><Input value={reference} onChange={(event) => setReference(event.target.value)} /></label>
            <p className="form-note">Payments land in your available balance, not in any purchase order escrow.</p>
          </div>
          <div className="qr-ticket">
            <QRCodeSVG value={payload} size={176} bgColor="#ffffff" fgColor="#0d1d30" level="M" marginSize={1} />
            <span className="qr-live"><i aria-hidden="true" />Renews in {seconds}s</span>
            <strong>{money(Number(amount || 0))} <small>SUI</small></strong>
            <small>{company}, session PP-{sessionId}</small>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
