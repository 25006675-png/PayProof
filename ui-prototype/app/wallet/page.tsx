"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpRight, BadgeCheck, Bell, CheckCircle2, ChevronDown, CircleDollarSign, Clock3, ExternalLink, Landmark, LockKeyhole, Plus, QrCode, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const transactions = [
  { title: "Settlement received", detail: "PO-2454 · Bowl & Co.", amount: "+12,400.00", time: "Today, 11:42", type: "in" },
  { title: "Wallet top up", detail: "Business bank · ending 4402", amount: "+5,000.00", time: "Yesterday, 16:08", type: "in" },
  { title: "Supplier withdrawal", detail: "0x71F…9A2", amount: "−4,920.00", time: "28 Aug, 09:20", type: "out" },
  { title: "B2C QR collection", detail: "Receipt QR-1842", amount: "+320.00", time: "27 Aug, 18:34", type: "in" },
];

function Logo() {
  return <a className="logo" href="/"><span className="logo-mark brand-logo-mark" aria-hidden="true"><img src="/proofpay-logo.png" alt="" width="40" height="40" /></span><span>ProofPay</span></a>;
}

function formatBalance(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function WalletPage() {
  const [balance, setBalance] = useState(12480);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [qrAmount, setQrAmount] = useState("320.00");
  const [qrReference, setQrReference] = useState("Walk-in sale");
  const [qrSeconds, setQrSeconds] = useState(30);
  const [qrSession, setQrSession] = useState(1842);
  const [notice, setNotice] = useState("Wallet actions in this prototype update the on-screen balance.");

  useEffect(() => {
    if (!qrOpen) return;
    const timer = window.setInterval(() => {
      setQrSeconds((current) => {
        if (current <= 1) {
          setQrSession((session) => session + 1);
          return 30;
        }
        return current - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [qrOpen]);

  const qrValue = useMemo(() => JSON.stringify({ network: "Sui Testnet", merchant: "GreenBite Trading", amount: qrAmount || "0.00", currency: "USDC", reference: qrReference || "B2C sale", session: `PP-${qrSession}` }), [qrAmount, qrReference, qrSession]);

  function topUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    setBalance((current) => current + value);
    setNotice(`${formatBalance(value)} USDC added to the available wallet balance.`);
    setAmount("");
    setTopUpOpen(false);
  }

  function withdraw(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > balance) return;
    setBalance((current) => current - value);
    setNotice(`${formatBalance(value)} USDC withdrawal prepared for approval.`);
    setAmount("");
    setWithdrawOpen(false);
  }

  return (
    <div className="buyer-shell wallet-shell">
      <header className="app-header"><Logo /><nav><a href="/workspace">Overview</a><a href="/orders">Orders</a><a className="nav-active" href="/wallet">Wallet</a><a href="/workspace#deliveries">Activity</a></nav><div className="app-user"><button className="app-icon" aria-label="Notifications"><Bell size={17} /></button><button className="user-button"><span className="user-avatar unified-avatar"><WalletCards size={16} /></span><span><strong>GreenBite Trading</strong><small>Business workspace</small></span><ChevronDown size={14} /></button></div></header>

      <main className="buyer-main wallet-main">
        <a className="wallet-back" href="/workspace"><ArrowLeft size={15} />Back to business workspace</a>
        <section className="app-title wallet-title"><div><span>PROOFPAY BUSINESS WALLET · SUI TESTNET</span><h1>Money you can move.</h1><p>Add funds, withdraw available USDC and collect B2C payments without touching funds protected inside purchase-order escrow.</p></div><span className="wallet-verified"><BadgeCheck size={17} />VERIFIED BUSINESS</span></section>

        <section className="wallet-balance-grid">
          <article className="wallet-balance-card">
            <div className="wallet-balance-top"><div><span>AVAILABLE WALLET BALANCE</span><small>Spendable · withdrawable</small></div><WalletCards size={25} /></div>
            <strong>{formatBalance(balance)} <small>USDC</small></strong>
            <p><span><i />Sui Testnet</span><span>0x71F…9A2</span></p>
            <div className="wallet-actions">
              <button type="button" onClick={() => { setAmount(""); setTopUpOpen(true); }}><span><Plus size={18} /></span><strong>Top up</strong><small>Add funds</small></button>
              <button type="button" onClick={() => { setAmount(""); setWithdrawOpen(true); }}><span><ArrowUpRight size={18} /></span><strong>Withdraw</strong><small>Move out</small></button>
              <button type="button" onClick={() => { setQrSeconds(30); setQrOpen(true); }}><span><QrCode size={18} /></span><strong>B2C QR</strong><small>Collect payment</small></button>
            </div>
          </article>

          <article className="wallet-protected-card">
            <div className="wallet-protected-head"><span><LockKeyhole size={19} /></span><div><small>SMART CONTRACT FUNDS</small><h2>Protected, not withdrawable.</h2></div></div>
            <div className="wallet-protected-row"><span>Buying escrow<small>Across 3 orders</small></span><strong>70,400 <small>USDC</small></strong></div>
            <div className="wallet-protected-row"><span>Supplier receivables<small>Release follows each PO</small></span><strong>44,500 <small>USDC</small></strong></div>
            <p><ShieldCheck size={15} />Wallet actions cannot move or combine these balances.</p>
          </article>
        </section>

        <div className="wallet-notice" role="status"><CheckCircle2 size={16} /><span>{notice}</span></div>

        <section className="wallet-content-grid">
          <article className="work-panel wallet-qr-promo">
            <div className="wallet-qr-copy"><span className="card-label">B2C PAYMENT COLLECTION</span><h2>Turn a customer payment into available USDC.</h2><p>Create a short-lived merchant QR for a walk-in or delivery sale. Successful payment lands in the spendable wallet, not inside B2B escrow.</p><button type="button" onClick={() => { setQrSeconds(30); setQrOpen(true); }}>Create payment QR <ArrowRight size={16} /></button></div>
            <div className="wallet-qr-preview"><div><QrCode size={46} /><span>LIVE QR</span></div><small>Amount locked</small><strong>320.00 USDC</strong><p><RefreshCw size={12} />Refreshes every 30 seconds</p></div>
          </article>

          <article className="work-panel wallet-activity">
            <div className="panel-head"><div><span className="card-label">WALLET ACTIVITY</span><h2>Recent movements</h2></div><button>Export <ExternalLink size={13} /></button></div>
            <div className="wallet-activity-list">{transactions.map((transaction) => <div key={`${transaction.title}-${transaction.time}`}><span className={transaction.type === "in" ? "activity-direction activity-in" : "activity-direction activity-out"}>{transaction.type === "in" ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span><p><strong>{transaction.title}</strong><small>{transaction.detail} · {transaction.time}</small></p><b className={transaction.type === "in" ? "amount-in" : ""}>{transaction.amount}<small> USDC</small></b></div>)}</div>
          </article>
        </section>

        <section className="wallet-security-strip"><span><ShieldCheck size={17} /></span><div><strong>Available balance and escrow are separate accounting domains.</strong><p>Only settled or directly funded USDC becomes withdrawable. Secured PO funds stay governed by their smart-contract rules.</p></div><a href="/orders">View protected orders <ArrowRight size={15} /></a></section>
      </main>

      <Dialog open={topUpOpen} onOpenChange={setTopUpOpen}>
        <DialogContent className="wallet-dialog"><DialogHeader><span className="card-label">ADD AVAILABLE FUNDS</span><DialogTitle>Top up ProofPay Wallet</DialogTitle><DialogDescription>This adds spendable USDC to the business wallet. It does not fund a purchase order automatically.</DialogDescription></DialogHeader><form onSubmit={topUp}><label><span>Amount</span><div className="wallet-amount-input"><Input autoFocus type="number" min="1" step="0.01" placeholder="5,000.00" value={amount} onChange={(event) => setAmount(event.target.value)} /><b>USDC</b></div></label><label><span>Funding source</span><div className="wallet-source"><Landmark size={17} /><p><strong>Business bank · ending 4402</strong><small>Demo funding rail</small></p><BadgeCheck size={16} /></div></label><div className="wallet-dialog-note"><ShieldCheck size={14} />Funds appear in Available Balance after confirmation.</div><Button type="submit" className="wallet-dialog-primary">Review top up <ArrowRight size={16} /></Button></form>
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="wallet-dialog"><DialogHeader><span className="card-label">WITHDRAW AVAILABLE FUNDS</span><DialogTitle>Move USDC out</DialogTitle><DialogDescription>Only the available wallet balance can be withdrawn. Purchase-order escrow remains locked.</DialogDescription></DialogHeader><form onSubmit={withdraw}><label><span>Amount · {formatBalance(balance)} USDC available</span><div className="wallet-amount-input"><Input autoFocus type="number" min="1" max={balance} step="0.01" placeholder="1,000.00" value={amount} onChange={(event) => setAmount(event.target.value)} /><b>USDC</b></div></label><label><span>Destination</span><div className="wallet-source"><CircleDollarSign size={17} /><p><strong>0x71F…9A2</strong><small>Verified treasury address</small></p><BadgeCheck size={16} /></div></label><div className="wallet-dialog-note"><LockKeyhole size={14} />Escrowed 70,400 USDC is excluded from this limit.</div><Button type="submit" className="wallet-dialog-primary">Review withdrawal <ArrowRight size={16} /></Button></form>
        </DialogContent>
      </Dialog>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="wallet-dialog b2c-qr-dialog"><DialogHeader><span className="card-label">DYNAMIC B2C COLLECTION</span><DialogTitle>Create customer payment QR</DialogTitle><DialogDescription>The amount and merchant are signed into a short-lived payment request. This demo refreshes the QR every 30 seconds.</DialogDescription></DialogHeader><div className="b2c-qr-grid"><div className="b2c-qr-form"><label><span>Customer pays</span><div className="wallet-amount-input"><Input type="number" min="0" step="0.01" value={qrAmount} onChange={(event) => setQrAmount(event.target.value)} /><b>USDC</b></div></label><label><span>Payment reference</span><Input value={qrReference} onChange={(event) => setQrReference(event.target.value)} /></label><div className="b2c-qr-facts"><span><ShieldCheck size={14} />Recipient fixed</span><span><Clock3 size={14} />Short-lived request</span><span><WalletCards size={14} />Credits available wallet</span></div></div><div className="b2c-qr-ticket"><div className="b2c-qr-code"><QRCodeSVG value={qrValue} size={188} bgColor="#ffffff" fgColor="#0d1d30" level="M" marginSize={1} /></div><span className="b2c-qr-live"><i />LIVE · {qrSeconds}s</span><strong>{Number(qrAmount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} <small>USDC</small></strong><p>GreenBite Trading · PP-{qrSession}</p></div></div><div className="b2c-qr-warning"><RefreshCw size={15} /><span><strong>Dynamic anti-reuse session</strong><small>When the timer reaches zero, ProofPay creates a new payment session and invalidates the previous QR.</small></span></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
