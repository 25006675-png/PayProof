# PayProof Platform Terms of Service

**Version 1.0 · Effective 2 September 2026 · Governing law: Malaysia**

---

## Pilot notice — read this first

PayProof is currently operating as a **pilot on the Sui testnet**.

- Every amount you see is denominated in **test tokens with no monetary value**. No real money is held, transferred, or at risk.
- Testnet data, including escrow objects and settlement receipts, may be reset, pruned, or lost at any time.
- Features described in these Terms as operating "on settlement" or "on funding" run against testnet infrastructure and have not been audited for production use.
- Nothing in this pilot creates a payment service, a money-services business, or a regulated financial product.

Where a clause below describes commercial behaviour (fees, liability, custody), it states how PayProof is designed to work. During the pilot, clauses 10 and 11 apply in full and limit that behaviour further.

---

## 1. What PayProof is

**1.1** PayProof is a coordination and record-keeping platform for business-to-business trade. It lets a buyer and a supplier agree the contents of a purchase order, lock payment in an escrow smart contract on the Sui network, record delivery, and resolve disputes over what should be released.

**1.2** PayProof is **not a party to your trade**. The commercial agreement is between the buyer and the supplier. PayProof does not sell, buy, inspect, ship, or warrant any goods.

**1.3** PayProof is **not a bank, payment institution, escrow agent, or law firm**, and provides no legal advice. Any analysis produced by the platform, including AI-generated dispute analysis, is informational only.

**1.4** PayProof does not take custody of your funds. Funds are held by an escrow smart contract on Sui, and can only be released to the buyer address and supplier address recorded when the escrow was created. See clause 5.

## 2. Accounts, identity, and organisations

**2.1** You may sign in with a Google account (which derives a Sui zkLogin address for you) or by proving control of an existing Sui wallet.

**2.2** Your **verified email address** is the identity PayProof uses to bind invitations and permissions. You are responsible for keeping access to that email account secure.

**2.3** Accounts belong to an **organisation**. An organisation may hold a buying capability, a supplying capability, or both.

**2.4** The same organisation may not occupy both sides of a single purchase order. Roles are fixed per order, not per account.

**2.5** You must not create accounts to impersonate another business, or use an email address you do not control.

## 3. Purchase orders and invitations

**3.1** A buyer creates a purchase order specifying the supplier's email address, line items, quantities, unit prices, delivery date, and delivery location.

**3.2** PayProof issues an **invitation bound to the supplier's email address**. Only an account whose verified email matches that address may review or confirm the order, whether or not it holds the invitation link.

**3.3** Invitations expire **7 days** after issue. A buyer may replace an invitation at any time before it is accepted, which immediately invalidates the previous one, or cancel it outright.

**3.4** An order becomes binding between the parties when the supplier confirms it. Until then, either party may walk away and no funds are committed.

**3.5** The order as confirmed — its line items, quantities, prices, delivery terms, and any terms and conditions attached to it — is the **agreement between the parties** for the purposes of these Terms and the Dispute Policy.

## 4. Your agreement with your counterparty

**4.1** You and your counterparty may attach your own terms and conditions to an order. Those terms govern your trade.

**4.2** The **PayProof Dispute Resolution Policy** sets non-waivable procedural minimums for disputes handled on the platform. Where your terms conflict with those minimums, the Policy prevails to the extent of the conflict, and your terms continue to govern everything else. See Policy clause DP-1.3.

**4.3** PayProof does not review, approve, or verify the terms you attach, and takes no position on their enforceability.

## 5. Escrow, funding, and settlement

**5.1** The buyer funds an escrow smart contract on Sui. The escrow records the buyer address, the supplier address, the arbitrator address, the order reference, and a hash of the agreed order contents.

**5.2** **PayProof cannot move your funds.** The escrow releases value in exactly two circumstances:

- **(a)** the buyer and the supplier both approve the identical allocation; or
- **(b)** the appointed arbitrator signs an allocation, which the contract accepts without mutual approval.

**5.3** In both cases the contract enforces limits that no party, including PayProof, can override: the refund to the buyer plus the release to the supplier must equal the disputed amount exactly; the buyer's refund can never exceed the refund the buyer originally requested; and funds can only be sent to the buyer and supplier addresses fixed when the escrow was created.

**5.4** The undisputed portion of an order may be released to the supplier at any time during a dispute, and only the supplier can trigger that release.

**5.5** Where PayProof appoints the arbitrator under clause 6.3, PayProof's arbitrator holds the signing key described in 5.2(b). This is a real power over the disputed amount, bounded by 5.3, and it is disclosed here so you can decide whether to nominate your own arbitrator instead.

**5.6** Settlement produces an immutable on-chain receipt recording the allocation, the order hash, and the hash of the settled proposal.

## 6. Disputes

**6.1** Disputes about what should be released from escrow are handled under the **PayProof Dispute Resolution Policy**, which forms part of these Terms.

**6.2** PayProof provides AI-assisted analysis that may propose a settlement. Any proposal is **non-binding**: it takes effect only if both parties accept it. See clause 7.

**6.3** If the parties do not reach agreement within the periods set by the Policy, the case escalates to an arbitrator. By default this is an arbitrator appointed by PayProof. The parties may instead nominate their own arbitrator on the order before funding.

**6.4** Nothing in these Terms or the Policy prevents you from pursuing any legal remedy available to you, or requires you to treat a platform outcome as a final determination of your legal rights.

## 7. AI-assisted analysis

**7.1** PayProof uses automated analysis to summarise each side's case and, where the evidence and the applicable terms support it, to propose an allocation of the disputed amount.

**7.2** Every factual statement in that analysis must quote the evidence a party submitted, and every rule applied must quote either your agreement or the Dispute Policy. The system rejects its own output when a quote cannot be verified against its source.

**7.3** The analysis may be wrong, incomplete, or may decline to propose anything. It is **not legal advice** and is not a determination of liability.

**7.4** No allocation proposed by the system moves any funds. Money moves only under clause 5.2.

**7.5** You must not attempt to manipulate the analysis, including by embedding instructions in evidence text, filenames, or documents. Content submitted as evidence is treated as untrusted data, and attempts to influence the system this way may result in suspension under clause 8.

## 8. Acceptable use

**8.1** You must not use PayProof for trades in goods that are illegal in the buyer's or supplier's jurisdiction, or with parties subject to applicable sanctions.

**8.2** You must not submit evidence you know to be falsified, altered, or not your own, or make claims you know to be untrue.

**8.3** You must not attempt to access another organisation's orders, evidence, or invitations.

**8.4** PayProof may suspend access to an account or organisation that breaches this clause. Suspension does not alter the escrow: funds already locked remain subject to clause 5.

## 9. Data and records

**9.1** PayProof stores your order contents, evidence statements, evidence file metadata, dispute history, and audit trail in order to run the platform and to produce arbitration packages.

**9.2** Order hashes and settlement receipts are written to a public blockchain and **cannot be deleted**. Commercial details — line items, prices, evidence, and the identities of the parties — are held off-chain and are visible only to the parties to that order and, on escalation, the arbitrator.

**9.3** Evidence files are retained for the life of the dispute record. Where files are processed by an automated document-reading service, they are sent for extraction only and are not used to train third-party models.

**9.4** Personal data is handled in accordance with the Personal Data Protection Act 2010 (Malaysia).

## 10. Fees

**10.1** No fees are charged during the pilot.

**10.2** Any future fee will be published before it takes effect and will never be deducted from an escrow balance without the express approval required by clause 5.2.

## 11. Liability

**11.1** During the pilot, all amounts are test tokens with no monetary value, and PayProof accepts **no liability for any loss** arising from your use of the platform.

**11.2** PayProof is not liable for the performance of your counterparty, the quality or conformity of goods, delivery outcomes, or the commercial merits of any dispute.

**11.3** PayProof is not liable for the content or consequences of any AI-generated analysis, which is provided on the basis set out in clause 7.

**11.4** PayProof is not liable for blockchain network conditions, including transaction failure, congestion, chain reorganisation, or loss of access to a wallet or signing key by a party.

**11.5** Nothing in this clause excludes liability that cannot be excluded under Malaysian law.

## 12. Suspension and termination

**12.1** You may stop using PayProof at any time. Orders already funded remain governed by clause 5 until settled.

**12.2** PayProof may withdraw the pilot, in whole or in part, on notice. Where it does, parties will be given a reasonable opportunity to settle open escrows first.

## 13. Governing law

**13.1** These Terms are governed by the laws of Malaysia, and the courts of Malaysia have jurisdiction over any dispute about the Terms themselves.

**13.2** Clause 13.1 governs your relationship with PayProof. It does not determine the governing law of your trade with your counterparty, which is a matter for your own agreement.

## 14. Changes

**14.1** These Terms are versioned. The version and effective date appear at the top of this document.

**14.2** Material changes will be notified before they take effect. Orders already funded continue under the version in force when the escrow was created.

## 15. Contact

Questions about these Terms, the Dispute Policy, or a specific case should be raised through the workspace, which attaches the relevant order record automatically.

---

*Related: [PayProof Dispute Resolution Policy](./dispute-policy.md)*
