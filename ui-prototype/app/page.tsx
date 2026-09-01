"use client";

import { type PointerEvent as ReactPointerEvent, useEffect } from "react";
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
        <img src="/proofpay-logo.png" alt="" width="40" height="40" />
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

function GoogleLoginBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
          <DialogTitle>Sign in to ProofPay</DialogTitle>
          <DialogDescription>
            Use one verified business account to manage every purchase and
            supply trade.
          </DialogDescription>
        </DialogHeader>

        <div
          className="google-auth-route"
          aria-label="Google account connects to the ProofPay Business Workspace"
        >
          <div>
            <span className="google-route-icon">
              <GoogleMark />
            </span>
            <small>Identity provider</small>
            <strong>Google account</strong>
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
              <img src="/proofpay-logo.png" alt="" width="40" height="40" />
            </span>
            <small>Destination</small>
            <strong>Business workspace</strong>
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
            <small>
              {hasSupabaseConfig()
                ? "Secure Google OAuth via Supabase"
                : "Demo session when OAuth is not configured"}
            </small>
          </span>
          <ArrowRight size={17} />
        </button>
        {error && (
          <p className="google-auth-error" role="alert">
            {error}
          </p>
        )}

        <p className="google-auth-privacy">
          <ShieldCheck size={14} />
          ProofPay never sees or stores your Google password. Production
          authentication is completed on Google&apos;s secure domain.
        </p>
        <div className="google-auth-foot">
          <span>ONE BUSINESS ACCOUNT</span>
          <span>ROLE SET PER ORDER</span>
          <span>NO PASSWORD COLLECTION</span>
        </div>
      </DialogContent>
    </Dialog>
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
      <h2>One workspace for every trade.</h2>
      <p>
        Sign in once to buy from suppliers, fulfil customer orders and follow
        every protected settlement.
      </p>
      <div className="business-access-card">
        <span className="business-access-symbol">
          <ArrowLeftRight size={21} />
        </span>
        <div>
          <small>PROOFPAY BUSINESS WORKSPACE</small>
          <strong>Purchase · Supply · Inspect · Settle</strong>
          <p>Your position is fixed separately on every purchase order.</p>
        </div>
        <BadgeCheck size={19} />
      </div>
      <GoogleLoginBanner />
      <p className="workspace-rule">
        <ShieldCheck size={13} />
        Your organisation may buy on one order and supply on another — never
        both sides of the same trade.
      </p>
      <small className="legal-copy">
        Demo access. Production accounts verify the organisation and permissions
        server-side.
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
          <span>Ops Atlas · Standalone concept</span>
        </footer>
      </main>
    </MotionConfig>
  );
}
