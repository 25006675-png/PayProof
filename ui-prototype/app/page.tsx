"use client";

import { type PointerEvent as ReactPointerEvent, useEffect } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import {
  ArrowRight,
  ArrowLeftRight,
  BadgeCheck,
  Box,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  FileCheck2,
  Fingerprint,
  LockKeyhole,
  PackageCheck,
  ShieldCheck,
  Truck,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  animate,
  motion,
  MotionConfig,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  demoGoogleLogin,
  hasSupabaseConfig,
  startSupabaseGoogleLogin,
} from "@/lib/payproof-api";
import { authenticateConnectedWallet, beginGoogleZkLogin } from "@/lib/auth";

const flow = [
  {
    number: "01",
    icon: WalletCards,
    title: "Fund",
    copy: "Buyer secures USDC against the agreed purchase order.",
  },
  {
    number: "02",
    icon: Truck,
    title: "Deliver",
    copy: "Supplier ships with visible proof that payment is ready.",
  },
  {
    number: "03",
    icon: FileCheck2,
    title: "Verify",
    copy: "Buyer records accepted, missing or damaged quantities.",
  },
  {
    number: "04",
    icon: PackageCheck,
    title: "Settle",
    copy: "Accepted value releases; only disputed value stays held.",
  },
];

function Logo() {
  return (
    <a className="logo" href="#top" aria-label="ProofPay home">
      <span className="logo-mark brand-logo-mark" aria-hidden="true">
        <img src="/assets/proofpay-logo.jpg" alt="" width="40" height="40" />
      </span>
      <span>ProofPay</span>
    </a>
  );
}

function GoogleMark() {
  return (
    <span className="google-mark" aria-hidden="true">
      G
    </span>
  );
}

function LegacyGoogleLoginBanner() {
  const router = useRouter();
  const account = useCurrentAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showMoreOptions, setShowMoreOptions] = useState(false);

  const shortenAddress = (address: string) =>
    `${address.slice(0, 6)}\u2026${address.slice(-4)}`;

  async function login() {
    setBusy(true);
    setError("");
    try {
      if (hasSupabaseConfig()) {
        await startSupabaseGoogleLogin();
      } else {
        await demoGoogleLogin("buyer@greenbite.demo", "Shen En");
        router.push("/workspace");
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The demo sign-in service is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="google-cta">
          <GoogleMark />
          Continue with Google
          <ArrowRight size={17} />
        </Button>
      </DialogTrigger>
      <DialogContent className="google-auth-dialog">
        <div className="google-auth-orbit" aria-hidden="true">
          <span />
          <i />
        </div>
        <div className="google-auth-topline">
          <div className="google-auth-brand">
            <GoogleMark />
            <strong>Google</strong>
          </div>
          <span>
            <LockKeyhole size={13} />
            Secure sign-in
          </span>
        </div>

        <DialogHeader className="google-auth-heading">
          <DialogTitle>Continue with Google</DialogTitle>
          <DialogDescription>
            Creates your secure PayProof account through a verified Sui
            identity.
          </DialogDescription>
        </DialogHeader>

        <div
          className="google-auth-route"
          aria-label="Google, real Sui zkLogin, and a PayProof account with a Sui address for signing"
        >
          <div>
            <span className="google-route-icon">
              <GoogleMark />
            </span>
            <small>IDENTITY</small>
            <strong>Google</strong>
          </div>
          <span className="google-route-line">
            <i />
            <ArrowRight size={15} />
          </span>
          <div>
            <span className="proofpay-route-icon zklogin-route-icon">
              <Fingerprint size={18} />
            </span>
            <small>PAYMENT PROOF</small>
            <strong>Real Sui zkLogin</strong>
          </div>
          <span className="google-route-line">
            <i />
            <ArrowRight size={15} />
          </span>
          <div>
            <span
              className="proofpay-route-icon brand-logo-mark"
              aria-hidden="true"
            >
              <img src="/assets/proofpay-logo.jpg" alt="" width="40" height="40" />
            </span>
            <small>ACCOUNT</small>
            <strong>PayProof account + Sui address for signing</strong>
          </div>
        </div>

        <div className="google-auth-role">
          <span>
            <ArrowLeftRight size={18} />
          </span>
          <div>
            <small>ONE ACCOUNT · ROLE SET PER ORDER</small>
            <strong>ProofPay Business Workspace</strong>
          </div>
          <BadgeCheck size={18} />
        </div>

        <button
          className="google-auth-continue"
          type="button"
          onClick={() => void login()}
          disabled={busy}
        >
          <GoogleMark />
          <span>
            <strong>{busy ? "Signing in…" : "Continue with Google"}</strong>
            <small>Creates your secure PayProof account</small>
          </span>
          <ArrowRight size={17} />
        </button>

        <button
          className="auth-more-options"
          type="button"
          aria-expanded={showMoreOptions}
          onClick={() => setShowMoreOptions((visible) => !visible)}
        >
          <span>More sign-in options</span>
          <ChevronRight size={15} className={showMoreOptions ? "open" : ""} />
        </button>

        {showMoreOptions && (
          <div className="wallet-auth-option">
            <div className="wallet-auth-copy">
              <span className="wallet-auth-icon">
                <WalletCards size={18} />
              </span>
              <div>
                <small>ALTERNATIVE LOGIN PATH</small>
                <strong>Connect existing Sui wallet</strong>
                <small>
                  Creates your PayProof account using that verified address.
                </small>
              </div>
            </div>
            <ConnectButton>
              <span className="wallet-connect-label">
                {account ? "Wallet connected" : "Connect wallet"}
                <ArrowRight size={14} />
              </span>
            </ConnectButton>
            {account && (
              <p className="wallet-auth-verified" role="status">
                <BadgeCheck size={14} />
                <span>
                  <strong>Verified Sui address</strong>
                  <small>{shortenAddress(account.address)}</small>
                </span>
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="google-auth-error" role="alert">
            {error}
          </p>
        )}

        <p className="google-auth-privacy">
          <ShieldCheck size={14} />
          Supabase stores private app data. Sui signs and records escrow
          transactions. ProofPay never sees or stores your Google password.
        </p>
        <div className="google-auth-foot">
          <strong>Powered by Sui</strong>
          <span>PRIVATE APP DATA IN SUPABASE</span>
          <span>NO PASSWORD COLLECTION</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoogleLoginBanner() {
  const router = useRouter();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [busy, setBusy] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [error, setError] = useState("");
  const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

  async function googleLogin() {
    setBusy(true);
    setError("");
    try {
      await beginGoogleZkLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Google sign-in could not be started.");
      setBusy(false);
    }
  }

  async function walletLogin() {
    if (!account) return;
    setBusy(true);
    setError("");
    try {
      await authenticateConnectedWallet({
        address: account.address,
        sign: (message) => dAppKit.signPersonalMessage({ message }),
      });
      router.push("/workspace");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Wallet ownership could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-entry">
      <button className="google-cta" type="button" onClick={() => void googleLogin()} disabled={busy}>
        <GoogleMark />
        <span>
          <strong>{busy ? "Preparing sign-in…" : "Continue with Google"}</strong>
          <small>Includes a Sui zkLogin address</small>
        </span>
        <ArrowRight size={17} />
      </button>

      <button className="auth-more-options" type="button" aria-expanded={walletOpen} onClick={() => setWalletOpen((open) => !open)}>
        <span>Other sign-in options</span>
        <ChevronRight size={15} className={walletOpen ? "open" : ""} />
      </button>

      {walletOpen && (
      <>
      <div className="auth-choice-divider"><span>or use an existing wallet</span></div>

      <div className="wallet-auth-option wallet-auth-inline">
        <div className="wallet-auth-copy">
          <span className="wallet-auth-icon"><WalletCards size={18} /></span>
          <div>
            <strong>Connect existing Sui wallet</strong>
            <small>For users who already manage a Sui wallet.</small>
          </div>
        </div>
        <ConnectButton>
          <span className="wallet-connect-label">
            {account ? "Wallet connected" : "Connect wallet"}
            <ArrowRight size={14} />
          </span>
        </ConnectButton>
        {account && (
          <>
            <p className="wallet-auth-verified" role="status">
              <BadgeCheck size={14} />
              <span><strong>Connected address</strong><small>{shortAddress(account.address)}</small></span>
            </p>
            <button className="wallet-signin-button" type="button" onClick={() => void walletLogin()} disabled={busy}>
              <ShieldCheck size={15} />
              Sign in with this wallet
              <ArrowRight size={14} />
            </button>
            <small className="wallet-signin-help">You will sign a readable message. No transaction or fee.</small>
          </>
        )}
      </div>
      </>
      )}

      {error && <p className="google-auth-error" role="alert">{error}</p>}
      <p className="auth-entry-assurance"><LockKeyhole size={13} /> Google uses Sui zkLogin. Wallet sign-in verifies ownership without spending funds.</p>
    </div>
  );
}

function trackPointer(event: ReactPointerEvent<HTMLElement>) {
  const bounds = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty(
    "--pointer-x",
    `${event.clientX - bounds.left}px`,
  );
  event.currentTarget.style.setProperty(
    "--pointer-y",
    `${event.clientY - bounds.top}px`,
  );
}

function useLuxuryTilt(strength = 5) {
  const reduceMotion = useReducedMotion();
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const springX = useSpring(rotateX, {
    stiffness: 190,
    damping: 22,
    mass: 0.55,
  });
  const springY = useSpring(rotateY, {
    stiffness: 190,
    damping: 22,
    mass: 0.55,
  });

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    trackPointer(event);
    if (reduceMotion) return;

    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    rotateX.set(y * -strength);
    rotateY.set(x * strength);
  };

  const onPointerLeave = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return {
    style: { rotateX: springX, rotateY: springY, transformPerspective: 1200 },
    onPointerMove,
    onPointerLeave,
  };
}

function AnimatedNumber({ value }: { value: number }) {
  const count = useMotionValue(0);
  const reducedMotion = useReducedMotion();
  const formatted = useTransform(count, (latest) =>
    Math.round(latest).toLocaleString("en-US"),
  );

  useEffect(() => {
    if (reducedMotion) {
      count.set(value);
      return;
    }

    const controls = animate(count, value, {
      duration: 1.15,
      delay: 0.62,
      ease: [0.25, 1, 0.5, 1],
    });

    return () => controls.stop();
  }, [count, reducedMotion, value]);

  return (
    <span
      className="animated-number"
      aria-label={value.toLocaleString("en-US")}
    >
      <motion.span aria-hidden="true">{formatted}</motion.span>
    </span>
  );
}

function AccessPanel() {
  const tilt = useLuxuryTilt(5.5);

  return (
    <motion.aside
      id="access"
      className="access-panel"
      aria-label="Open the ProofPay Business Workspace"
      initial={{ opacity: 0, y: 22 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.58, delay: 0.42, ease: [0.25, 1, 0.5, 1] }}
      whileHover={{ y: -7, scale: 1.008 }}
      style={tilt.style}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
    >
      <div className="panel-kicker">
        <Fingerprint size={15} />
        Secure business access
      </div>
      <h2>Open your workspace.</h2>
      <p>Purchase or supply from one account. Your role is set separately on each order.</p>
      <GoogleLoginBanner />
      <small className="legal-copy consent-copy">
        By continuing you agree to the{" "}
        <a href="/legal/terms">Terms of Service</a> and the{" "}
        <a href="/legal/dispute-policy">Dispute Resolution Policy</a>. Your
        company details are verified before you can fund or receive payments.
      </small>
      <Dialog>
        <DialogTrigger asChild>
          <button className="staff-entry" type="button">
            ProofPay staff access <ChevronRight size={14} />
          </button>
        </DialogTrigger>
        <DialogContent className="proof-dialog">
          <DialogHeader>
            <DialogTitle>Restricted staff access</DialogTitle>
            <DialogDescription>
              Staff accounts are invite-only and remain separate from business
              workspace onboarding.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </motion.aside>
  );
}

function OpsPreview() {
  const tilt = useLuxuryTilt(4);

  return (
    <motion.div
      className="settlement-ledger atlas-preview"
      aria-label="Active purchase order operations board"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.68, ease: [0.25, 1, 0.5, 1] }}
      whileHover={{ y: -8, scale: 1.006 }}
      style={tilt.style}
      onPointerMove={tilt.onPointerMove}
      onPointerLeave={tilt.onPointerLeave}
    >
      <div className="ops-head">
        <div>
          <span className="mini-label">ACTIVE PURCHASE ORDER</span>
          <h3>PO-2471 / Cooking oil</h3>
        </div>
        <span className="status-pill">
          <i />
          In inspection
        </span>
      </div>
      <div className="ops-metrics">
        <div>
          <small>Ordered</small>
          <strong>
            <AnimatedNumber value={100} />
          </strong>
          <span>cartons</span>
        </div>
        <div>
          <small>Accepted</small>
          <strong>
            <AnimatedNumber value={87} />
          </strong>
          <span>ready to settle</span>
        </div>
        <div>
          <small>Exception</small>
          <strong>
            <AnimatedNumber value={13} />
          </strong>
          <span>isolated</span>
        </div>
      </div>
      <div className="ops-timeline">
        {[
          "Order funded",
          "Supplier shipped",
          "Delivery recorded",
          "Buyer inspection",
        ].map((item, index) => (
          <div key={item} className={index === 3 ? "current" : "done"}>
            <span>{index < 3 ? <Check size={13} /> : index + 1}</span>
            <p>{item}</p>
            <small>{index < 3 ? "Complete" : "In progress"}</small>
          </div>
        ))}
      </div>
      <div className="ops-footer">
        <span>
          <Clock3 size={15} />
          Inspection closes in 43h 12m
        </span>
        <strong>
          <AnimatedNumber value={30000} /> USDC secured
        </strong>
      </div>
    </motion.div>
  );
}

export default function Home() {
  return (
    <MotionConfig reducedMotion="user">
      <main id="top" className="marketing-shell">
        <div className="paper-grid" aria-hidden="true" />
        <div className="luxury-atmosphere" aria-hidden="true">
          <span />
          <span />
          <i />
        </div>
        <motion.header
          className="marketing-header"
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.62, ease: [0.25, 1, 0.5, 1] }}
        >
          <Logo />
          <nav aria-label="Main navigation">
            <a href="#workflow">How it works</a>
            <a href="#roles">Workspace</a>
            <a href="#security">Security</a>
          </nav>
          <a className="header-action" href="#access">
            Open workspace <ArrowRight size={15} />
          </a>
        </motion.header>

        <section className="hero" onPointerMove={trackPointer}>
          <motion.div
            className="hero-copy"
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: {
                transition: { delayChildren: 0.04, staggerChildren: 0.085 },
              },
            }}
          >
            <motion.span
              className="eyebrow"
              variants={{
                hidden: { opacity: 0, y: 14 },
                show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
              }}
            >
              ONE ORDER. ONE SHARED RECORD.
            </motion.span>
            <motion.h1
              variants={{
                hidden: {},
                show: { transition: { staggerChildren: 0.11 } },
              }}
            >
              <span className="hero-line">
                <motion.span
                  variants={{
                    hidden: { opacity: 0, y: 72, filter: "blur(14px)" },
                    show: {
                      opacity: 1,
                      y: 0,
                      filter: "blur(0px)",
                      transition: { duration: 0.86, ease: [0.16, 1, 0.3, 1] },
                    },
                  }}
                >
                  Stop chasing
                </motion.span>
              </span>
              <span className="hero-line">
                <motion.span
                  variants={{
                    hidden: { opacity: 0, y: 72, filter: "blur(14px)" },
                    show: {
                      opacity: 1,
                      y: 0,
                      filter: "blur(0px)",
                      transition: { duration: 0.86, ease: [0.16, 1, 0.3, 1] },
                    },
                  }}
                >
                  invoices. Start
                </motion.span>
              </span>
              <span className="hero-line">
                <motion.span
                  variants={{
                    hidden: { opacity: 0, y: 72, filter: "blur(14px)" },
                    show: {
                      opacity: 1,
                      y: 0,
                      filter: "blur(0px)",
                      transition: { duration: 0.86, ease: [0.16, 1, 0.3, 1] },
                    },
                  }}
                >
                  closing trades.
                </motion.span>
              </span>
            </motion.h1>
            <motion.p
              variants={{
                hidden: { opacity: 0, y: 18 },
                show: { opacity: 1, y: 0, transition: { duration: 0.58 } },
              }}
            >
              Connect purchasing, supplying, delivery evidence and settlement in
              one operational workspace built for repeat B2B trade.
            </motion.p>
            <motion.div
              className="hero-assurance"
              variants={{
                hidden: { opacity: 0 },
                show: { opacity: 1, transition: { duration: 0.55 } },
              }}
            >
              <span>
                <ShieldCheck size={16} />
                No admin withdrawal
              </span>
              <span>
                <FileCheck2 size={16} />
                Verifiable settlement
              </span>
            </motion.div>
          </motion.div>
          <AccessPanel />
          <div className="ledger-wrap">
            <OpsPreview />
          </div>
        </section>

        <section
          className="contract-strip"
          aria-label="ProofPay trust statement"
        >
          <p>
            <LockKeyhole size={16} />
            Funds are held by the Sui smart contract — not by ProofPay.
          </p>
          <div>
            <span>PROGRAMMABLE ESCROW</span>
            <span>PARTIAL RELEASE</span>
            <span>SHARED RECORD</span>
          </div>
        </section>

        <section id="workflow" className="workflow section-frame">
          <div className="section-heading">
            <span>01 / THE SETTLEMENT PATH</span>
            <h2>A purchase order that knows when to pay.</h2>
            <p>
              Each action updates the same trade record. No duplicated
              spreadsheet, no ambiguous status, no full-payment hostage
              situation.
            </p>
          </div>
          <div className="workflow-list">
            {flow.map((step, index) => {
              const Icon = step.icon;
              return (
                <motion.article
                  key={step.number}
                  initial={{ opacity: 0, y: 22 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.35 }}
                  transition={{
                    duration: 0.5,
                    delay: index * 0.06,
                    ease: [0.25, 1, 0.5, 1],
                  }}
                  whileHover={{ y: -5 }}
                >
                  <div>
                    <span>{step.number}</span>
                    <Icon size={21} />
                  </div>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </motion.article>
              );
            })}
          </div>
        </section>

        <section id="roles" className="roles section-frame">
          <div className="roles-intro">
            <span>02 / ONE BUSINESS WORKSPACE</span>
            <h2>
              Buy on one order.
              <br />
              <em>Supply on the next.</em>
            </h2>
            <p>
              Your company uses one account for both capabilities, while every
              purchase order keeps buyer and supplier responsibilities separate.
            </p>
          </div>
          <div className="role-panels role-panels-unified">
            <motion.article
              className="business-panel business-buyer"
              initial={{ opacity: 0, x: -55, rotateY: -5 }}
              whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
              viewport={{ once: true, amount: 0.24 }}
              whileHover={{ y: -12, scale: 1.012 }}
              transition={{ duration: 0.72, ease: [0.16, 1, 0.3, 1] }}
              onPointerMove={trackPointer}
            >
              <div className="business-top">
                <span>FOR BUYERS</span>
                <Building2 size={24} />
              </div>
              <div className="business-copy">
                <h3>Protect cash before accepting goods.</h3>
                <p>
                  Build the order, secure payment, inspect delivery and release
                  only the value your team accepts.
                </p>
              </div>
              <ul>
                <li>
                  <Check size={15} />
                  Create and fund purchase orders
                </li>
                <li>
                  <Check size={15} />
                  Record accepted and disputed quantities
                </li>
                <li>
                  <Check size={15} />
                  Keep a verifiable settlement history
                </li>
              </ul>
            </motion.article>
            <motion.article
              className="business-panel business-supplier"
              initial={{ opacity: 0, x: 55, rotateY: 5 }}
              whileInView={{ opacity: 1, x: 0, rotateY: 0 }}
              viewport={{ once: true, amount: 0.24 }}
              whileHover={{ y: -12, scale: 1.012 }}
              transition={{
                duration: 0.72,
                delay: 0.08,
                ease: [0.16, 1, 0.3, 1],
              }}
              onPointerMove={trackPointer}
            >
              <div className="business-top">
                <span>FOR SUPPLIERS</span>
                <Box size={24} />
              </div>
              <div className="business-copy">
                <h3>Ship against funds you can verify.</h3>
                <p>
                  See the escrow before dispatch, attach evidence and receive
                  accepted value without waiting for a full dispute.
                </p>
              </div>
              <ul>
                <li>
                  <Check size={15} />
                  Verify secured funds before shipping
                </li>
                <li>
                  <Check size={15} />
                  Attach shipment and delivery evidence
                </li>
                <li>
                  <Check size={15} />
                  Receive immediate partial settlement
                </li>
              </ul>
            </motion.article>
            <div className="role-panels-cta">
              <div>
                <span>ONE VERIFIED BUSINESS ACCOUNT</span>
                <strong>
                  Use both trading capabilities without switching workspace.
                </strong>
              </div>
              <a href="#access">
                Open business workspace <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </section>

        <section id="security" className="security section-frame">
          <div className="security-statement">
            <span>03 / SECURITY BY CONSTRAINT</span>
            <h2>
              ProofPay can coordinate the trade.
              <br />
              <em>It cannot take the money.</em>
            </h2>
          </div>
          <div className="security-rules">
            <article>
              <span>01</span>
              <div>
                <h3>No platform withdrawal path</h3>
                <p>
                  The contract exposes no admin function that redirects
                  protected funds.
                </p>
              </div>
            </article>
            <article>
              <span>02</span>
              <div>
                <h3>Payout address is snapshotted</h3>
                <p>
                  The supplier address is fixed when the buyer funds the order.
                </p>
              </div>
            </article>
            <article>
              <span>03</span>
              <div>
                <h3>Evidence is anchored</h3>
                <p>
                  Commercial documents stay private while hashes preserve
                  verification.
                </p>
              </div>
            </article>
          </div>
        </section>

        <motion.section
          className="closing"
          initial={{ opacity: 0, y: 45, scale: 0.975 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
          onPointerMove={trackPointer}
        >
          <span>READY TO SETTLE THE NEXT TRADE?</span>
          <h2>End the “who moves first” standoff.</h2>
          <a href="#access">
            Open business workspace <ArrowRight size={18} />
          </a>
        </motion.section>
        <footer className="marketing-footer">
          <Logo />
          <p>Delivery-linked B2B settlement on Sui.</p>
          <nav className="marketing-footer-legal">
            <a href="/legal/terms">Terms of Service</a>
            <a href="/legal/dispute-policy">Dispute Policy</a>
          </nav>
          <span>Powered by Sui</span>
        </footer>
      </main>
    </MotionConfig>
  );
}
