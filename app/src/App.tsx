import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { FileCheck2, Plus, ShieldCheck } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { PAYPROOF_PACKAGE_ID } from "./config";

type View = "pay" | "verify";

const PaymentWorkspace = lazy(() =>
  import("./components/PaymentWorkspace").then((module) => ({
    default: module.PaymentWorkspace,
  })),
);
const VerifyReceipt = lazy(() =>
  import("./components/VerifyReceipt").then((module) => ({
    default: module.VerifyReceipt,
  })),
);

function App() {
  const [view, setView] = useState<View>("pay");

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <div className="header-inner">
          <button className="brand" onClick={() => setView("pay")} aria-label="PayProof home">
            <span className="brand-mark" aria-hidden="true">
              <FileCheck2 size={21} strokeWidth={2.2} />
            </span>
            <span>PayProof</span>
          </button>

          <nav className="primary-nav" aria-label="Primary navigation">
            <button
              className={view === "pay" ? "active" : ""}
              aria-current={view === "pay" ? "page" : undefined}
              onClick={() => setView("pay")}
            >
              <Plus size={16} /> New payment
            </button>
            <button
              className={view === "verify" ? "active" : ""}
              aria-current={view === "verify" ? "page" : undefined}
              onClick={() => setView("verify")}
            >
              <ShieldCheck size={16} /> Verify
            </button>
          </nav>

          <div className="header-actions">
            <span className="network-badge">
              <i aria-hidden="true" /> Testnet
            </span>
            <ConnectButton />
          </div>
        </div>
      </header>

      {!PAYPROOF_PACKAGE_ID && (
        <div className="setup-banner" role="status">
          <strong>Contract setup required.</strong> Add VITE_PAYPROOF_PACKAGE_ID after publishing the
          Move package to enable payments.
        </div>
      )}

      <main id="main-content" className="main-content">
        <div className="page-intro">
          <div>
            <p className="section-label">Sui payments for SMEs</p>
            <h1>{view === "pay" ? "Pay the order. Keep the proof." : "Trust, then verify."}</h1>
          </div>
          <p>
            {view === "pay"
              ? "Settle in SUI or USDC and bind the transaction to a private, detailed order receipt."
              : "Confirm that a receipt has not changed and that its payment finalized on Sui."}
          </p>
        </div>

        <Suspense fallback={<div className="view-loading" role="status">Loading workspace…</div>}>
          {view === "pay" ? <PaymentWorkspace /> : <VerifyReceipt />}
        </Suspense>
      </main>

      <footer className="app-footer">
        <span>PayProof</span>
        <p>Private order details, public payment certainty.</p>
        <span>Sui testnet</span>
      </footer>
    </div>
  );
}

export default App;
