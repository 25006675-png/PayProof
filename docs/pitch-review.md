# PayProof pitch review for a 3-minute pitch

Basis: the codebase as of 4 September 2026, after the v3 escrow publish (`0x132dda3d...6f30`). Track: MUBA Blockchain Hackathon, Sui, Payments and Stablecoins. Judges care about commercial viability.

How to read the levels:

- **Critical**: a judge can catch it or reward it inside three minutes. Fix before the pitch.
- **Medium**: fix if there is time. Affects Q&A more than the pitch.
- **Non-critical**: ignore for the pitch. Clean up later.

---

## 1. The pitch as a whole

### Critical

**1.1 Too many stakeholders**
- Why: slides 2 and 3 address buyers, suppliers, receiving teams, and finance at once. Three minutes carries one hero.
- Fix: the hero is the supplier who ships on 60-day credit. Every other party appears only as they touch the supplier's money.

**1.2 No positioning sentence**
- Why: the deck says what the product does but not what it replaces.
- Fix: "We replace credit terms and deposits with payment secured before dispatch and released on proof." Say it in the first 30 seconds and again at the end.

**1.3 No money slide**
- Why: no fee, no wedge customer, no checkable number. Commercial judges cannot score what they cannot price.
- Fix: one slide. Fee on settled value. First customers are suppliers with USD costs, for whom USDC is useful rather than a risk. One sourced figure, for example a Malaysian factoring rate or payment-delay statistic. The on-ramp line from 2.4.

**1.4 The demo must be the proof**
- Why: the wow is one signature splitting a delivery, not the word escrow.
- Fix: fund, ship, claim, and show the split on the explorer. Skip creation and confirmation on stage. Pre-fund the demo wallets with testnet USDC before the day, Circle's faucet needs a captcha.

### Medium

**1.5 Slides 3 and 5 are reading material**
- Fix: one picture and one sentence each. The five-row diagnostic becomes "email, chat, and spreadsheets record intent, none can hold money to a rule".

**1.6 Say "Sui" for a reason**
- Fix: one line: sponsored gas, zkLogin, native USDC, and an immutable receipt object. These are Sui features you actually use.

### Non-critical

- Naming and colour consistency between deck and app.

---

## 2. Overclaims

### Critical

**2.1 "Completely non-custodial, no admin withdrawal path"**
- Why it matters: a Sui judge will ask who holds the upgrade capability. The v3 package can still be upgraded, and a PayProof-chosen arbitrator decides every disputed split.
- Fix: run the make-immutable command on the v3 UpgradeCap right before the pitch and put that transaction on slide 6. Change the wording to "PayProof cannot pay itself. A named arbitrator decides only the disputed portion, capped by the buyer's own claim."

**2.2 "Seven steps, one state machine. Every rule is enforced by the contract"**
- Why it matters: four of the seven steps never touch the contract. Anyone who opens the Move file sees two states plus deadlines.
- Fix: use six steps to match the app stepper (Confirm, Fund, Ship, Deliver, Inspect, Settle). Reword to "money and deadlines are enforced on-chain, the workflow lives in one shared record and every money step is verified against the chain."

**2.3 Delivery QR on slides 4 and 5**
- Why it matters: it is a drawing with a fake countdown. The live demo has no QR. If one thing on the deck is fake, the judge assumes more is.
- Fix: cut it. Delivery is "either party records the handover", which is what the app does.

**2.4 Ringgit in, ringgit out for Malaysian SMEs**
- Why it matters: no licensed Malaysian exchange can sell USDC today. The deck implies a local product that does not yet exist. Silence here gets punished in Q&A.
- Fix: one honest line on the money slide: "Today buyers top up through an international on-ramp or a licensed exchange plus an in-app swap. A licensed ringgit rail is on the regulator's 2026 agenda."

### Medium

**2.5 "Quantity-based settlement" listed as an on-chain rule**
- Why: the contract settles amounts. Quantities become an amount in the browser, then the buyer signs it.
- Fix: "The buyer's signed quantity decision sets the amount. The contract enforces the amount."

**2.6 Arbitrator never mentioned**
- Why: a commercial judge will ask "who decides when they disagree".
- Fix: covered by 2.1 wording. Add "arbitration is the last step after policy-guided negotiation".

### Non-critical

- "Settlement health 92/100" and "70,400 USDC secured" are typed into demo pages. Remove or label as illustration.
- State names "Draft" and "Resolved / Closed" do not exist in the app. Use the app's names.
- Deck says ProofPay, product says PayProof. Pick one.
- README test counts were stale. Already corrected.

---

## 3. Underclaims

### Critical

**3.1 No wallet, no gas, no seed phrase**
- Why: this is the strongest answer to "will an SME actually use this". Google sign-in through zkLogin plus sponsored gas means the user only sees a Google button and ringgit amounts.
- Fix: one line on slide 4: "Sign in with Google. No wallet, no gas, no crypto knowledge."

**3.2 One signature pays the supplier and locks only the dispute**
- Why: since v3 the buyer's claim transaction pays the accepted value to the supplier in the same call. Nobody else has to act. This is the wow moment and the deck only hints at it.
- Fix: make it the live demo. Open a claim for 13 percent, show the 87 percent land in the supplier's address on the explorer while the claim is still open.

**3.3 Neither side can stall the other**
- Why: the first question every buyer and supplier asks is "what if the other side disappears". v3 answers it in the contract: buyer reclaims an unshipped escrow after the delivery date, supplier claims an uninspected one after the seven-day window. No counterparty, no PayProof.
- Fix: add as a seventh guarantee on slide 6: "Deadline paths. Neither party can hold the other's money hostage."

**3.4 Live on testnet with checkable links**
- Why: a judge can verify a link in ten seconds. Adjectives cannot be verified.
- Fix: last slide shows the package ID, the publish transaction, and the freeze transaction.

### Medium

**3.5 Evidence anchoring is now real**
- Why: slide 4 already claims it. The demo should prove it.
- Fix: after attaching a file, show the explorer link on the document row.

**3.6 The dispute policy exists**
- Why: slide 6 lists it as planned. A versioned policy and terms are in the app and quoted clause by clause.
- Fix: move it from "planned" to "built". Keep KYB and sanctions screening as planned.

### Non-critical, keep as Q&A answers

- AI reads a purchase order PDF or photo and compares lines with the order.
- Bounded, cited AI mediation on Malaysian statutes that abstains when evidence is thin.
- Every recorded step is verified against Sui events before it is saved. Replays are refused.
- An immutable receipt object closes every order with its approval mode.

---

## 4. Suggested three-minute structure

| Time | Content |
|---|---|
| 0:00 to 0:25 | One supplier, one late invoice, one sentence of positioning |
| 0:25 to 0:45 | How it works in six steps, one picture |
| 0:45 to 1:45 | Live demo: fund, ship, claim for 13 percent, 87 percent lands on the explorer |
| 1:45 to 2:10 | Guarantees: cannot pay itself, exception isolation, deadline paths, frozen package link |
| 2:10 to 2:40 | Money: fee, supplier wedge, on-ramp reality, one sourced number |
| 2:40 to 3:00 | Roadmap: guaranteed ringgit payout with a licensed partner, ringgit stablecoin when the regulator allows it. The ask |

---

## 5. Before-the-pitch checklist

- [ ] Freeze the v3 package and record the transaction on slide 6
- [ ] Update the Vercel and Render environment variables to the v3 package ID, and allow the package in the Enoki portal
- [ ] Pre-fund buyer and supplier demo accounts with testnet USDC
- [ ] Cut the QR from the deck
- [ ] Six steps on slide 5, app state names
- [ ] One product name everywhere
- [ ] Rehearse the demo twice against the live backend with the Sui verifier on
