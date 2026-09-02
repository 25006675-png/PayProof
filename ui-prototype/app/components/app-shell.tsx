"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { AlertCircle, Box, Building2, Check, CheckCircle2, ChevronDown, CircleHelp, Info, LogOut, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STATUS, TERMS, statusLabel, statusTone } from "@/lib/order-status";
import { MotionShell } from "@/app/components/motion";
import { clearSession, loadSession, signOutSession } from "@/lib/payproof-api";
import { clearZkLoginSession } from "@/lib/auth";

export function Logo() {
  return (
    <a className="logo" href="/">
      <span className="logo-mark brand-logo-mark" aria-hidden="true"><img src="/assets/proofpay-logo.jpg" alt="" width="40" height="40" /></span>
      <span>ProofPay</span>
    </a>
  );
}

export function HelpHint({ text, label = "More information" }: { text: string; label?: string }) {
  const id = useId();
  return (
    <span className="help-hint">
      <button type="button" className="help-hint-button" aria-label={label} aria-describedby={id}><CircleHelp size={15} aria-hidden="true" /></button>
      <span role="tooltip" id={id} className="help-hint-tip">{text}</span>
    </span>
  );
}

/** Status pills stay still. Pass live only for a process running in front of the user, such as mediation. */
export function StatusPill({ status, className = "", live = false }: { status: string; className?: string; live?: boolean }) {
  const active = live;
  return <span className={`pill pill-${statusTone(status)} ${active ? "pill-live" : ""} ${className}`} title={STATUS[status as keyof typeof STATUS]?.summary}>{active && <i aria-hidden="true" />}{statusLabel(status)}</span>;
}

export function RoleTag({ role, compact = false, label }: { role: "BUYER" | "SUPPLIER"; compact?: boolean; label?: string }) {
  return (
    <span className={`role-tag role-tag-${role.toLowerCase()} ${compact ? "role-tag-compact" : ""}`}>
      {role === "BUYER" ? <Building2 size={14} aria-hidden="true" /> : <Box size={14} aria-hidden="true" />}
      {label ?? (role === "BUYER" ? "Buying" : "Supplying")}
    </span>
  );
}

export function SampleTag() {
  return <span className="sample-tag" title="Sample order. Actions only change this sample, nothing is sent to the backend or Sui.">Sample</span>;
}

export function Notice({ tone = "info", children, onDismiss }: { tone?: "info" | "success" | "error"; children: ReactNode; onDismiss?: () => void }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : Info;
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={16} aria-hidden="true" />
      <div>{children}</div>
      {onDismiss && <button type="button" className="notice-dismiss" aria-label="Dismiss" onClick={onDismiss}><X size={14} /></button>}
    </div>
  );
}

export function PageTitle({ title, help, description, actions }: { title: string; help?: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="page-title">
      <div>
        <h1>{title}{help && <HelpHint text={help} />}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="page-title-actions">{actions}</div>}
    </section>
  );
}

export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true">{Array.from({ length: lines }, (_, index) => <span key={index} style={{ width: `${88 - (index % 3) * 18}%` }} />)}</div>;
}

/** Small ledger-style illustration for empty states. */
export function EmptyArt({ kind }: { kind: "inbox" | "documents" | "activity" }) {
  return (
    <svg className="empty-art" viewBox="0 0 120 72" width="120" height="72" aria-hidden="true">
      <rect x="10" y="12" width="100" height="50" rx="6" fill="var(--surface-2)" stroke="var(--rule-strong)" />
      {kind === "inbox" && <><path d="M10 40h28l6 8h32l6-8h28" fill="none" stroke="var(--rule-strong)" /><rect x="34" y="22" width="52" height="4" rx="2" fill="var(--blue-soft)" /><rect x="34" y="30" width="36" height="4" rx="2" fill="var(--blue-soft)" /></>}
      {kind === "documents" && <><rect x="26" y="4" width="34" height="44" rx="4" fill="#fff" stroke="var(--rule-strong)" /><rect x="32" y="14" width="22" height="3" rx="1.5" fill="var(--blue-soft)" /><rect x="32" y="22" width="18" height="3" rx="1.5" fill="var(--blue-soft)" /><rect x="32" y="30" width="20" height="3" rx="1.5" fill="var(--blue-soft)" /><rect x="66" y="26" width="30" height="8" rx="2" fill="var(--yellow-soft)" /></>}
      {kind === "activity" && <><path d="M20 48l18-12 14 8 16-18 14 6 18-10" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="68" cy="26" r="3" fill="var(--blue)" /></>}
    </svg>
  );
}

function UserMenu({ company, email }: { company: string; email?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const signOut = async () => {
    try { await signOutSession(); } catch { clearSession(); }
    clearZkLoginSession();
    window.location.href = "/";
  };
  const initials = company.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "PP";
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-menu-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="user-menu-avatar" aria-hidden="true">{initials}</span>
        <span className="user-menu-text"><strong>{company}</strong><small>{email ?? "Not signed in"}</small></span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="user-menu-panel" role="menu">
          <div className="user-menu-head"><strong>{company}</strong><small>{email ?? "Browsing without an account"}</small></div>
          <a role="menuitem" href="/legal/terms">Terms of Service</a>
          <a role="menuitem" href="/legal/dispute-policy">Dispute Resolution Policy</a>
          {email
            ? <button type="button" role="menuitem" onClick={() => void signOut()}><LogOut size={14} aria-hidden="true" />Sign out</button>
            : <a role="menuitem" href="/#access">Sign in</a>}
        </div>
      )}
    </div>
  );
}

export function AppShell({ active, company, children, actionCount = 0 }: { active: "overview" | "orders" | "wallet"; company: string; children: ReactNode; actionCount?: number }) {
  const [email, setEmail] = useState<string>();
  useEffect(() => { setEmail(loadSession()?.user.email); }, []);
  return (
    <MotionShell>
    <div className="shell">
      <header className="shell-header">
        <Logo />
        <nav aria-label="Main">
          <a className={active === "overview" ? "nav-current" : ""} href="/workspace" aria-current={active === "overview" ? "page" : undefined}>
            Overview{actionCount > 0 && <span className="nav-count" aria-label={`${actionCount} actions needed`}>{actionCount}</span>}
          </a>
          <a className={active === "orders" ? "nav-current" : ""} href="/orders" aria-current={active === "orders" ? "page" : undefined}>Orders</a>
          <a className={active === "wallet" ? "nav-current" : ""} href="/wallet" aria-current={active === "wallet" ? "page" : undefined}>Wallet</a>
        </nav>
        <UserMenu company={company} email={email} />
      </header>
      <main className="shell-main">{children}</main>
      <footer className="shell-footer">
        <span>ProofPay on Sui Testnet</span>
        <span><a href="/legal/terms">Terms of Service</a><a href="/legal/dispute-policy">Dispute Resolution Policy</a></span>
      </footer>
    </div>
    </MotionShell>
  );
}

export type AgreementClause = string;

/**
 * The agreement people accept before an action: the documents that govern it,
 * the clauses that matter for this step, and one acceptance on behalf of the
 * company. Collapses into a record line once accepted.
 */
export function AgreementBlock({ company, clauses, label, accepted, onChange, record, extraChecks = [] }: {
  company: string; clauses: AgreementClause[]; label?: string; accepted: boolean; onChange: (accepted: boolean) => void;
  record?: { by: string; at: string };
  extraChecks?: Array<{ id: string; text: string; checked: boolean; onChange: (checked: boolean) => void }>;
}) {
  const id = useId();
  if (record) {
    return (
      <div className="agreement agreement-done">
        <Check size={15} aria-hidden="true" />
        <span>Accepted by <strong>{record.by}</strong> on {new Date(record.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} under Terms of Service and Dispute Resolution Policy version {TERMS.version}.</span>
      </div>
    );
  }
  return (
    <div className="agreement">
      <div className="agreement-head">
        <strong>Agreement</strong>
        <span>{TERMS.documents.map((document, index) => <span key={document.href}>{index > 0 && " and "}<a href={document.href} target="_blank" rel="noreferrer">{document.title}</a></span>)}, version {TERMS.version}, effective {TERMS.effective}.</span>
      </div>
      <ol className="agreement-clauses">
        {clauses.map((clause, index) => <li key={index}>{clause}</li>)}
      </ol>
      {extraChecks.map((check) => (
        <label key={check.id} className="agreement-check agreement-check-secondary">
          <input type="checkbox" checked={check.checked} onChange={(event) => check.onChange(event.target.checked)} />
          <span>{check.text}</span>
        </label>
      ))}
      <label className="agreement-check" htmlFor={id}>
        <input id={id} type="checkbox" checked={accepted} onChange={(event) => onChange(event.target.checked)} />
        <span>{label ?? `I accept these terms on behalf of ${company}.`}</span>
      </label>
    </div>
  );
}

export type ConsentCheck = { id: string; text: string };

/** A confirmation step built on the agreement block. */
export function ConsentDialog({ open, onOpenChange, title, description, clauses, checks = [], company, confirmLabel, onConfirm, busy = false, children }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: ReactNode; clauses: AgreementClause[]; checks?: ConsentCheck[]; company: string;
  confirmLabel: string; onConfirm: () => void | Promise<void>; busy?: boolean; children?: ReactNode;
}) {
  const [accepted, setAccepted] = useState(false);
  const [extra, setExtra] = useState<Record<string, boolean>>({});
  useEffect(() => { if (open) { setAccepted(false); setExtra({}); } }, [open]);
  const complete = accepted && checks.every((check) => extra[check.id]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="consent-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <AgreementBlock company={company} clauses={clauses} accepted={accepted} onChange={setAccepted}
          extraChecks={checks.map((check) => ({ id: check.id, text: check.text, checked: Boolean(extra[check.id]), onChange: (checked) => setExtra((value) => ({ ...value, [check.id]: checked })) }))} />
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="btn-primary" disabled={!complete || busy} onClick={() => void onConfirm()}>{busy ? "Working" : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FileField({ label, hint, accept, onFile, disabled = false, file }: { label: string; hint?: string; accept: string; onFile: (file: File | null) => void; disabled?: boolean; file?: File | null }) {
  const id = useId();
  return (
    <label className={`file-field ${disabled ? "file-field-disabled" : ""}`} htmlFor={id}>
      <Upload size={16} aria-hidden="true" />
      <span>
        <strong>{file ? file.name : label}</strong>
        <small>{file ? `${(file.size / 1024).toFixed(0)} KB` : hint ?? "PDF, image or text file up to 8 MB"}</small>
      </span>
      <input id={id} type="file" accept={accept} disabled={disabled} onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
    </label>
  );
}
