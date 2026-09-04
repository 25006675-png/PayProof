"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Camera, Check, ClipboardCopy, Clock3, CreditCard, ExternalLink, Landmark, LockKeyhole, Plus, QrCode, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AppShell, HelpHint, Notice, PageTitle } from "@/app/components/app-shell";
import { type DemoOrder, formatOrderMoney as money } from "@/lib/demo-orders";
import { type PaymentRequest, parsePaymentRequest, useEscrowActions } from "@/lib/escrow-actions";
import { explorerTransactionUrl, suiDAppKit, TESTNET_USDC_TYPE } from "@/lib/sui-dapp-kit";
import { useWorkspace } from "@/lib/use-workspace";
import { AnimatedAmount, LiftCard } from "@/app/components/motion";

type Movement = { id: string; type: "in" | "out"; title: string; detail: string; amount: number; currency?: string; at: string; state: "pending" | "complete"; transactionDigest?: string };
type Method = "card" | "bank";
type Balances = { usdc: number };

function sumOrders(orders: DemoOrder[], pick: (order: DemoOrder) => number = (order) => order.value): string {
  return `${money(orders.reduce((total, order) => total + pick(order), 0))} USDC`;
}

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
  const [balances, setBalances] = useState<Balances | null>(null);
  const [balanceNote, setBalanceNote] = useState("");
  const [movements, setMovements] = useState<Movement[]>([]);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const address = workspace.session?.suiAddress ?? "";
  const balance = balances?.usdc ?? null;

  const readBalances = useCallback(async (): Promise<Balances | null> => {
    if (!address) return null;
    const client = suiDAppKit.getClient("testnet");
    const usdc = await client.getBalance({ owner: address, coinType: TESTNET_USDC_TYPE });
    return { usdc: Number(usdc.balance.balance) / 1_000_000 };
  }, [address]);

  const refreshBalances = useCallback(() => readBalances()
    .then((value) => { setBalances(value); setBalanceNote("Balances read from Sui Testnet."); })
    .catch((cause) => setBalanceNote(cause instanceof Error ? `The balance could not be read: ${cause.message}` : "The balance could not be read.")), [readBalances]);

  useEffect(() => {
    if (!workspace.ready) return;
    setMovements(loadMovements(workspace.accountKey));
    if (!address) { setBalances(null); setBalanceNote(workspace.live ? "Sign in with Google zkLogin or connect a Sui wallet to load the on-chain balance." : "Sign in to load your balance."); return; }
    void refreshBalances();
  }, [workspace.ready, workspace.accountKey, workspace.live, address, refreshBalances]);

  // A signed-in wallet only reflects real orders. Sample orders stay on the orders page.
  const ledgerOrders = workspace.live ? workspace.liveOrders : workspace.orders;
  const position = useMemo(() => {
    const funded = (role: "BUYER" | "SUPPLIER") => ledgerOrders.filter((order) => order.role === role && ["funded", "in_transit", "delivered", "dispute_open", "negotiation_open", "arbitration_pending", "settlement_pending"].includes(order.status));
    const buying = funded("BUYER");
    const supplying = funded("SUPPLIER");
    const held = ledgerOrders.filter((order) => order.inspection && order.inspection.heldValue > 0 && !["settled", "cancelled"].includes(order.status));
    const pendingIn = movements.filter((item) => item.state === "pending" && item.type === "in").reduce((sum, item) => sum + item.amount, 0);
    const pendingOut = movements.filter((item) => item.state === "pending" && item.type === "out").reduce((sum, item) => sum + item.amount, 0);
    return {
      buying: { value: sumOrders(buying), count: buying.length },
      supplying: { value: sumOrders(supplying), count: supplying.length },
      held: { value: sumOrders(held, (order) => order.inspection?.heldValue ?? 0), count: held.length },
      pendingIn, pendingOut,
    };
  }, [ledgerOrders, movements]);

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
            <span>Available balance<HelpHint text="USDC held at your Sui address. Escrowed funds are not included because the escrow contract holds them, not your address." /></span>
            <span className="wallet-network"><i aria-hidden="true" />Sui Testnet</span>
          </div>
          {balances === null ? (
            <strong className="wallet-amount"><span className="wallet-amount-text">Not connected</span></strong>
          ) : (
            <strong className="wallet-amount"><AnimatedAmount value={balances.usdc} decimals={2} /> <small>USDC</small></strong>
          )}
          {balances !== null && balances.usdc === 0 && <p className="wallet-note">New orders are priced in USDC. Get testnet USDC from <a className="link-light" href={`https://faucet.circle.com/?address=${address}`} target="_blank" rel="noreferrer">Circle&apos;s faucet</a>, then it appears here.</p>}
          <p className="wallet-address">{address ? <><code>{address.slice(0, 10)}...{address.slice(-8)}</code><button type="button" className="text-button text-button-light" onClick={() => void navigator.clipboard.writeText(address)}><ClipboardCopy size={12} aria-hidden="true" />Copy address</button></> : balanceNote}</p>
          {address && balanceNote && <p className="wallet-note">{balanceNote}</p>}
          <div className="wallet-actions">
            <button type="button" onClick={() => setTopUpOpen(true)}><span><Plus size={17} aria-hidden="true" /></span><strong>Top up</strong><small>Card, bank or crypto</small></button>
            <button type="button" onClick={() => setWithdrawOpen(true)}><span><ArrowUpRight size={17} aria-hidden="true" /></span><strong>Withdraw</strong><small>To bank or Sui address</small></button>
            <button type="button" onClick={() => setQrOpen(true)}><span><QrCode size={17} aria-hidden="true" /></span><strong>Scan and pay</strong><small>Or show your code</small></button>
          </div>
        </LiftCard>

        <article className="panel money-ledger" aria-labelledby="position-title">
          <div className="panel-head"><h2 id="position-title">Where your money is</h2></div>
          <dl className="money-rows">
            <div><dt>Available to spend</dt>{balances === null ? <dd className="text">Not connected</dd> : <dd>{money(balances.usdc)} USDC</dd>}</div>
            {position.pendingIn > 0 && <div className="money-row-pending"><dt><Clock3 size={13} aria-hidden="true" />Top-ups in progress</dt><dd>{money(position.pendingIn)} USDC</dd></div>}
            {position.pendingOut > 0 && <div className="money-row-pending"><dt><Clock3 size={13} aria-hidden="true" />Withdrawals in progress</dt><dd>{money(position.pendingOut)} USDC</dd></div>}
            <div><dt><LockKeyhole size={13} aria-hidden="true" />Secured for your purchases<small>{position.buying.count} {position.buying.count === 1 ? "order" : "orders"}</small></dt><dd>{position.buying.value}</dd></div>
            <div><dt><LockKeyhole size={13} aria-hidden="true" />Secured for your sales<small>{position.supplying.count} {position.supplying.count === 1 ? "order" : "orders"}</small></dt><dd>{position.supplying.value}</dd></div>
            {position.held.count > 0 && <div><dt>Held for open claims<small>{position.held.count} {position.held.count === 1 ? "claim" : "claims"}</small></dt><dd>{position.held.value}</dd></div>}
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
                <div><strong>{item.title}</strong><small>{item.detail}. {new Date(item.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{item.transactionDigest && <> <a className="link" href={explorerTransactionUrl(item.transactionDigest)} target="_blank" rel="noreferrer">Receipt on Suiscan<ExternalLink size={11} aria-hidden="true" /></a></>}</small></div>
                <span className={`pill ${item.state === "pending" ? "pill-attention" : "pill-success"}`}>{item.state === "pending" ? "Pending" : "Complete"}</span>
                <strong className={`num ${item.type === "in" ? "amount-in" : ""}`}>{item.type === "in" ? "+" : "-"}{money(item.amount)} USDC</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TopUpDialog open={topUpOpen} onOpenChange={setTopUpOpen} company={workspace.company}
        onSubmitted={(movement) => { record(movement); setNotice("Your USDC top-up was submitted. It shows as pending until the funds arrive at your Sui address."); }} />
      <WithdrawDialog open={withdrawOpen} onOpenChange={setWithdrawOpen} available={balance ?? 0} onSubmitted={(movement) => { record(movement); setNotice("Your withdrawal request was submitted and is pending review."); }} />
      <PaymentQrDialog open={qrOpen} onOpenChange={setQrOpen} company={workspace.company} address={address}
        onPaid={(movement) => { record(movement); void refreshBalances(); setNotice(`${money(movement.amount)} ${movement.currency} paid. Your receipt is on Sui.`); }} />
    </AppShell>
  );
}

function TopUpDialog({ open, onOpenChange, company, onSubmitted }: { open: boolean; onOpenChange: (open: boolean) => void; company: string; onSubmitted: (movement: Movement) => void }) {
  const [step, setStep] = useState<"amount" | "details" | "processing" | "done">("amount");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("card");
  const [card, setCard] = useState({ name: "", number: "", expiry: "", cvc: "" });
  const [bank, setBank] = useState(BANKS[0]);
  const [agreed, setAgreed] = useState(false);
  const value = Number(amount);
  const validAmount = Number.isFinite(value) && value >= 0.1;
  const cardValid = card.name.trim().length > 2 && /^\d{16}$/.test(card.number.replace(/\s/g, "")) && /^\d{2}\/\d{2}$/.test(card.expiry) && /^\d{3,4}$/.test(card.cvc);
  const close = (next: boolean) => { if (!next) { setStep("amount"); setAmount(""); setAgreed(false); setCard({ name: "", number: "", expiry: "", cvc: "" }); } onOpenChange(next); };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setStep("processing");
    window.setTimeout(() => {
      onSubmitted({ id: crypto.randomUUID(), type: "in", title: "Top-up", detail: method === "card" ? `Card ending ${card.number.slice(-4)}` : `Bank transfer from ${bank}`, amount: value, currency: "USDC", at: new Date().toISOString(), state: "pending" });
      setStep("done");
    }, 1400);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="money-dialog">
        {step === "done" ? (
          <>
            <span className="order-created-mark"><Check size={22} aria-hidden="true" /></span>
            <DialogHeader><DialogTitle>Top-up submitted</DialogTitle><DialogDescription>{money(value)} USDC is on its way to your wallet. Card and bank top-ups usually settle within a few minutes. This demo does not move real funds.</DialogDescription></DialogHeader>
            <DialogFooter><Button className="btn-primary" onClick={() => close(false)}>Done</Button></DialogFooter>
          </>
        ) : step === "processing" ? (
          <div className="processing"><RefreshCw size={22} className="spin" aria-hidden="true" /><strong>Processing your top-up</strong><span>Do not close this window.</span></div>
        ) : (
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Top up wallet</DialogTitle>
              <DialogDescription>Add USDC to your available balance. Top-ups never fund a purchase order directly. You fund escrow from the order page.</DialogDescription>
            </DialogHeader>
            {step === "amount" ? (
              <>
                <label className="field"><span>Amount</span><div className="amount-input"><Input autoFocus type="number" min="0.1" step="0.01" placeholder="1.00" value={amount} onChange={(event) => setAmount(event.target.value)} /><b>USDC</b></div><small>Minimum 0.10 USDC.</small></label>
                <div className="method-list" role="radiogroup" aria-label="Payment method">
                  {([
                    { id: "card", icon: CreditCard, title: "Debit or credit card", detail: "Visa or Mastercard. Arrives in minutes. 1.5% processing fee." },
                    { id: "bank", icon: Landmark, title: "Bank transfer (FPX)", detail: "Malaysian online banking. Arrives within one business hour. No fee." },
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
                <div className="summary-strip"><span>Top-up amount</span><strong>{money(value)} USDC</strong><button type="button" className="text-button" onClick={() => setStep("amount")}>Change</button></div>
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
                <label className="consent-check"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>I confirm the funds come from {company}&apos;s own account and I accept the Terms of Service for wallet top-ups.</span></label>
                <DialogFooter><Button variant="outline" type="button" onClick={() => setStep("amount")}>Back</Button><Button className="btn-primary" type="submit" disabled={!agreed || (method === "card" && !cardValid)}>{method === "card" ? `Pay ${money(value * 1.015)} USDC` : `Continue to ${bank}`}</Button></DialogFooter>
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
        <form onSubmit={(event) => { event.preventDefault(); onSubmitted({ id: crypto.randomUUID(), type: "out", title: "Withdrawal", detail: destination === "bank" ? `To bank account ending ${account.slice(-4)}` : `To Sui address ${account.slice(0, 6)}...${account.slice(-4)}`, amount: value, currency: "USDC", at: new Date().toISOString(), state: "pending" }); close(false); }}>
          <DialogHeader><DialogTitle>Withdraw</DialogTitle><DialogDescription>Only the available balance can be withdrawn. Funds secured in purchase orders stay in escrow.</DialogDescription></DialogHeader>
          <label className="field"><span>Amount</span><div className="amount-input"><Input autoFocus type="number" min="1" max={available} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="1,000.00" /><b>USDC</b></div><small>{money(available)} USDC available.</small></label>
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

/** Reads QR codes from the camera where the browser offers BarcodeDetector. Everywhere else the
 *  request can be pasted, which is also how a desktop user pays from a phone photo. */
function QrScanner({ onResult, onError }: { onResult: (text: string) => void; onError: (message: string) => void }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!video) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Detector = (window as any).BarcodeDetector as (new (options: { formats: string[] }) => { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> }) | undefined;
    if (!Detector) { onError("This browser cannot scan from the camera. Paste the payment request instead."); return; }
    let stream: MediaStream | undefined;
    let timer = 0;
    let stopped = false;
    const detector = new Detector({ formats: ["qr_code"] });
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then((media) => {
        if (stopped) { media.getTracks().forEach((track) => track.stop()); return; }
        stream = media;
        video.srcObject = media;
        return video.play();
      })
      .then(() => {
        timer = window.setInterval(async () => {
          try {
            const codes = await detector.detect(video);
            const hit = codes.find((code) => code.rawValue);
            if (hit) { window.clearInterval(timer); onResult(hit.rawValue); }
          } catch { /* keep scanning */ }
        }, 350);
      })
      .catch(() => onError("The camera could not be opened. Paste the payment request instead."));
    return () => { stopped = true; window.clearInterval(timer); stream?.getTracks().forEach((track) => track.stop()); };
  }, [video, onResult, onError]);
  return <video ref={setVideo} className="qr-scanner" muted playsInline aria-label="Camera view for scanning a payment QR" />;
}

function PaymentQrDialog({ open, onOpenChange, company, address, onPaid }: { open: boolean; onOpenChange: (open: boolean) => void; company: string; address: string; onPaid: (movement: Movement) => void }) {
  const escrow = useEscrowActions();
  // Receive
  const [amount, setAmount] = useState("320.00");
  const [reference, setReference] = useState("Walk-in sale");
  const [seconds, setSeconds] = useState(30);
  const [sessionId, setSessionId] = useState(() => Math.floor(1000 + Math.random() * 9000));
  // Pay
  const [scanning, setScanning] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [request, setRequest] = useState<PaymentRequest | null>(null);
  const [payError, setPayError] = useState("");
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState<{ digest: string; receiptObjectId?: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setSeconds(30);
    const timer = window.setInterval(() => setSeconds((current) => { if (current <= 1) { setSessionId((id) => id + 1); return 30; } return current - 1; }), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  const payload = useMemo(() => JSON.stringify({
    v: 1, network: "sui:testnet", to: address || "unknown", merchant: company, amount: amount || "0.00", currency: "USDC", coinType: TESTNET_USDC_TYPE,
    reference: reference || "Sale", session: `PP-${sessionId}`,
  } satisfies PaymentRequest), [address, company, amount, reference, sessionId]);

  const close = (next: boolean) => {
    if (!next) { setScanning(false); setPasted(""); setPasteOpen(false); setRequest(null); setPayError(""); setPaid(null); }
    onOpenChange(next);
  };

  const read = useCallback((text: string) => {
    setScanning(false);
    try {
      const parsed = parsePaymentRequest(text);
      if (parsed.currency !== "USDC" || parsed.coinType !== TESTNET_USDC_TYPE) throw new Error("PayProof only supports USDC payment requests.");
      setRequest(parsed);
      setPayError("");
    } catch (cause) { setRequest(null); setPayError(cause instanceof Error ? cause.message : "That is not a payment request."); }
  }, []);
  const scanError = useCallback((message: string) => { setScanning(false); setPasteOpen(true); setPayError(message); }, []);

  const pay = async () => {
    if (!request) return;
    setPaying(true);
    setPayError("");
    try {
      const result = await escrow.payRequest(request);
      setPaid(result);
      onPaid({ id: crypto.randomUUID(), type: "out", title: `Paid ${request.merchant || "a merchant"}`, detail: `${request.reference}, session ${request.session}`, amount: Number(request.amount), currency: "USDC", at: new Date().toISOString(), state: "complete", transactionDigest: result.digest });
    } catch (cause) {
      setPayError(cause instanceof Error ? cause.message : "The payment failed.");
    } finally {
      setPaying(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="money-dialog qr-dialog">
        <DialogHeader>
          <DialogTitle>Scan and pay</DialogTitle>
          <DialogDescription>Scan a merchant&apos;s code to pay them with one sponsored transaction and keep a receipt on Sui, or show your own code so a customer can pay {company}.</DialogDescription>
        </DialogHeader>
        <div className="qr-split">
          <section className="qr-pane" aria-labelledby="qr-scan-title">
            <h3 id="qr-scan-title"><Camera size={15} aria-hidden="true" />Scan to pay</h3>
            {paid ? (
              <div className="qr-paid">
                <span className="order-created-mark"><Check size={22} aria-hidden="true" /></span>
                <strong>Paid</strong>
                <p>{money(Number(request?.amount ?? 0))} {request?.currency} went to {request?.merchant || "the merchant"}. Your receipt object is owned by your address and can be verified against the request hash.</p>
                <p className="form-note"><a className="link" href={explorerTransactionUrl(paid.digest)} target="_blank" rel="noreferrer">View the payment on Suiscan<ExternalLink size={12} aria-hidden="true" /></a>{paid.receiptObjectId && <> Receipt <code>{paid.receiptObjectId.slice(0, 10)}...{paid.receiptObjectId.slice(-6)}</code></>}</p>
                <Button variant="outline" type="button" onClick={() => { setPaid(null); setRequest(null); setPasted(""); }}>Pay someone else</Button>
              </div>
            ) : request ? (
              <>
                <dl className="fact-list">
                  <div><dt>Pay to</dt><dd>{request.merchant || "Merchant"}<small><code>{request.to.slice(0, 10)}...{request.to.slice(-6)}</code></small></dd></div>
                  <div><dt>Amount</dt><dd><strong>{money(Number(request.amount))} {request.currency}</strong></dd></div>
                  <div><dt>Reference</dt><dd>{request.reference}<small>Session {request.session}</small></dd></div>
                  <div><dt>Signed by</dt><dd>{escrow.signingAddress ? <code>{escrow.signingAddress.slice(0, 10)}...{escrow.signingAddress.slice(-6)}</code> : "Sign in first"}</dd></div>
                </dl>
                <p className="form-note">This is a direct payment, not an escrow. It cannot be reversed once signed.</p>
                {payError && <p className="form-error" role="alert">{payError}</p>}
                <div className="action-buttons"><Button variant="outline" type="button" onClick={() => { setRequest(null); setPasted(""); }}>Back</Button><Button className="btn-primary" type="button" disabled={paying || !escrow.signingAddress} onClick={() => void pay()}>{paying ? "Paying" : `Pay ${money(Number(request.amount))} ${request.currency}`}</Button></div>
              </>
            ) : scanning ? (
              <>
                <QrScanner onResult={read} onError={scanError} />
                <Button variant="outline" type="button" onClick={() => setScanning(false)}>Stop camera</Button>
              </>
            ) : (
              <>
                <button type="button" className="qr-scan-launch" onClick={() => { setPayError(""); setScanning(true); }}><Camera size={28} aria-hidden="true" /><strong>Open camera</strong><small>Point at a PayProof payment code</small></button>
                {payError && <p className="form-error" role="alert">{payError}</p>}
                {pasteOpen ? (
                  <>
                    <label className="field"><span>Paste the request text</span><textarea value={pasted} onChange={(event) => setPasted(event.target.value)} rows={3} placeholder='{"v":1,"network":"sui:testnet","to":"0x...","amount":"320.00",...}' /></label>
                    <Button className="btn-primary" type="button" disabled={!pasted.trim()} onClick={() => read(pasted)}>Review payment<ArrowRight size={14} aria-hidden="true" /></Button>
                  </>
                ) : (
                  <button type="button" className="text-button" onClick={() => setPasteOpen(true)}>No camera here? Paste the request text instead</button>
                )}
              </>
            )}
          </section>
          <section className="qr-pane" aria-labelledby="qr-mine-title">
            <h3 id="qr-mine-title"><QrCode size={15} aria-hidden="true" />My code</h3>
            <div className="qr-ticket">
              {address ? <QRCodeSVG value={payload} size={168} bgColor="#ffffff" fgColor="#0d1d30" level="M" marginSize={1} /> : <span>Sign in to show your payment code</span>}
              <span className="qr-live"><i aria-hidden="true" />Renews in {seconds}s</span>
              <strong>{money(Number(amount || 0))} <small>USDC</small></strong>
              <small>{company}, session PP-{sessionId}</small>
              {address && <button type="button" className="text-button" onClick={() => void navigator.clipboard.writeText(payload)}><ClipboardCopy size={12} aria-hidden="true" />Copy request text</button>}
            </div>
            <div className="form-grid">
              <label className="field"><span>Amount</span><div className="amount-input"><Input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /><b>USDC</b></div></label>
              <label className="field field-wide"><span>Reference</span><Input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={128} /></label>
            </div>
            <p className="form-note">Payments land in your available balance, not in any purchase order escrow. The payer keeps a receipt whose hash matches this request.</p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
