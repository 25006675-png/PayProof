# ProofPay Live Demo Presentation Script

## Demo outcome

This script presents one complete 30 USDC purchase between:

- **Buyer:** Choong Trading Sdn. Bhd.
- **Supplier:** FreshSource Foods Sdn. Bhd.
- **Purchase order:** PP-DEMO-0905

The buyer starts with **40.00 USDC**, funds **30.00 USDC**, and has **10.00 USDC** left in the wallet. Three strawberry cartons worth **3.60 USDC** are disputed. Both companies anchor evidence on Sui: the supplier's dispatch photograph and the buyer's receiving photograph. Under DP-7.11 the loss is proved but its cause is not attributed to either company, so the expected proposal divides the **3.60 USDC** equally, **1.80 USDC** each. Both parties accept and the settlement is verified on-chain.

Latest case final position:

- Buyer wallet: **11.80 USDC**
- Supplier receives: **28.20 USDC** in total
- Escrow remaining: **0.00 USDC**

If a newly generated live mediation recommends a different split, use the actual result on screen. The buyer's final wallet is always:

```text
10.00 USDC remaining after funding + buyer refund from the proposal
```

## Files used during the presentation

- [Purchase order PDF](demo-upload-files/PP-DEMO-0905-purchase-order.pdf)
- [Commercial agreement PDF](demo-upload-files/PP-DEMO-0905-agreement.pdf)
- [Delivery note PDF](demo-upload-files/DO-FS-0905.pdf)
- [Supplier dispatch photograph](demo-upload-files/supplier-dispatch.png)
- [Buyer receiving photograph](demo-upload-files/receiving-damage.png)
- [Copy-and-paste form text](demo-upload-files/COPY-PASTE-TEXT.txt)

## Before the audience arrives

Prepare these tabs and windows:

1. Buyer browser signed in and ready on the workspace.
2. Supplier browser signed in as the exact invited supplier email.
3. Buyer wallet showing approximately 40.00 USDC.
4. The purchase order PDF open in a separate tab.
5. The commercial agreement PDF open in a separate tab.
6. The `demo-upload-files` folder open in File Explorer.
7. The guided sample open in a hidden backup tab.

From the buyer account menu, set the company name to **Choong Trading Sdn. Bhd.** before creating the order.

Use the normal workflow for the presentation. Keep the guided sample only as a visual fallback if a network or AI request takes too long.

## Presentation script

### 1. Opening context

**On screen:** ProofPay homepage.

**Say:**

> Imagine a small distributor ordering fresh produce from a supplier. The buyer is prepared to pay, and the supplier is prepared to ship, but neither side wants to carry all the risk. If part of the delivery arrives damaged, they may have different photographs, different records, and no shared process for deciding what happens to the money.

> In this demonstration, Choong Trading is purchasing 30 USDC of fresh produce from FreshSource Foods. I will create the order live, secure the payment, record a damaged delivery, submit evidence from both companies, and settle only the disputed amount.

Sign in as the buyer.

### 2. Show the buyer wallet

**On screen:** Choong Trading buyer workspace.

Open **Wallet** and show **40.00 USDC available**.

**Say:**

> The buyer currently has 40 USDC available. The order will use 30 USDC, leaving a 10 USDC operating balance. Gas is sponsored, so this new USDC order does not require the buyer or supplier to hold SUI.

### 3. Import and compare the purchase order

**On screen:** Buyer order creation dialog.

1. Click **New purchase order**.
2. Choose **I am buying**.
3. Click **Import from file**.
4. Upload `PP-DEMO-0905-purchase-order.pdf`.
5. Let the AI extraction finish.
6. Keep the extracted result visible.

**Say:**

> ProofPay has extracted the supplier, delivery details, quantities, unit prices, and the 30 USDC total. I will now compare that result with the original document before continuing.

Open `PP-DEMO-0905-purchase-order.pdf` beside the extracted result. Point briefly to:

- PO reference `PP-DEMO-0905`
- Buyer and supplier names
- Three product lines
- Expected delivery and location
- Total value of `30.00 USDC`

Return to the extracted result and verify every populated field.

**Say:**

> The extracted values match the source PO. AI saves the data-entry work, while the user remains responsible for checking the commercial terms.

### 4. Attach the agreement and create the order

1. Confirm the invited supplier email.
2. Attach `PP-DEMO-0905-agreement.pdf`.
3. Open the agreement briefly after attaching it.
4. Point to the inspection, evidence, partial-release, and mutual-approval terms.
5. Return to the order form.
6. Accept the agreement acknowledgement.
7. Send the order for supplier confirmation.

**Say while showing the agreement:**

> This agreement explains how evidence and partial damage will be handled. It allows accepted goods to be released separately and requires both companies to approve any mediated settlement.

When the order is created, click **Copy link**.

**Say:**

> The invitation is private and tied to the supplier email. For this live demo, I will use the generated confirmation link directly so email delivery does not slow us down.

### 5. Supplier confirms the order

**On screen:** Supplier browser.

Paste the invitation link and open the order as the supplier.

Review the products and select:

- **I have reviewed every line**
- **I accept these terms on behalf of FreshSource Foods Sdn. Bhd.**

Click **Confirm and accept terms**.

**Say:**

> The supplier sees the same quantities, prices, delivery terms, and documents. Confirmation means the two companies now agree to one shared version. It does not move any money yet.

### 6. Buyer funds escrow

**On screen:** Buyer browser.

Refresh the order if necessary, then click **Fund escrow** and approve the 30 USDC transaction.

Wait for the funded status.

**Say:**

> The buyer is now securing 30 USDC in a programmable escrow. The supplier knows the payment exists, but cannot take it before the order conditions are satisfied.

Open the buyer wallet and show approximately **10.00 USDC available**.

**Say:**

> The wallet previously showed 40 USDC. It now shows 10 USDC available because 30 USDC has moved into the order escrow. Available money and secured money are deliberately shown separately.

Do not repeat the funding action if the interface is waiting for confirmation. Refresh and verify the transaction first.

### 7. Supplier independently verifies escrow

**On screen:** Supplier order page.

In the top **Escrow** summary, point to:

- Verified on Sui status
- Shortened escrow object ID
- Copy control
- **View on Suiscan** link

Open the Suiscan link in a new tab.

**Say:**

> The supplier does not have to trust a status stored only by ProofPay. They can open the escrow object on Sui Testnet and independently verify that the funded object exists.

Return to the supplier order.

### 8. Supplier records dispatch evidence

Click **Ship the goods** and enter:

- Carrier: `DHL Express`
- Tracking number: `DHL-PP-0905-MY`

Upload `supplier-dispatch.png` and mark the order as shipped.

Open the photograph briefly after upload.

**Say:**

> FreshSource records the carrier information and an image of the intact, wrapped pallet before collection. This creates a timestamped before-delivery record while the goods are still under the supplier's control.

### 9. Buyer records delivery

**On screen:** Buyer order page.

Click **The goods have arrived**.

Enter delivery reference `DO-FS-0905` and upload `DO-FS-0905.pdf`.

Open the delivery note briefly. Point to:

- PO and delivery references
- All three line quantities and prices
- Total declared value of 30 USDC
- Recorded exception value of 3.60 USDC

**Say:**

> The delivery note matches the original purchase order and records the receiving exception. Notice that recording arrival is not the same as accepting the whole shipment. The money remains protected until the buyer completes the inspection.

### 10. Buyer records the partial damage

Choose **Some items missing or damaged**.

Enter:

- Strawberries accepted: `7 cartons`
- Strawberries damaged: `3 cartons`
- Blueberries accepted: `6 cartons`
- Avocados accepted: `6 crates`

Paste the buyer statement from `COPY-PASTE-TEXT.txt` and upload `receiving-damage.png`.

Open the image briefly.

**Say:**

> The receiving photograph shows three crushed and wet strawberry cartons. The blueberries and avocados are accepted in full. At 1.20 USDC per carton, the damaged quantity is worth exactly 3.60 USDC.

Use the normal **Open claim for 3.60 USDC** action.

**Say after the claim opens:**

> This is a partial claim. ProofPay does not hold the entire 30 USDC hostage. The undisputed 26.40 USDC can be released to the supplier, while only 3.60 USDC remains under review.

### 11. Supplier responds

**On screen:** Supplier browser.

Choose **Dispute with evidence**. Upload `supplier-dispatch.png` and paste the supplier statement from `COPY-PASTE-TEXT.txt`.

**Say:**

> The supplier accepts that damage was visible at delivery, but shows that the cartons were intact and wrapped before carrier collection. The parties agree on the damaged quantity and value. They disagree about where responsibility lies.

Submit the response.

### 12. Request AI mediation

Click **Request AI mediation**.

When the result appears, first show the proposed numbers. Then open the **AI analysis** tab and show:

- Common ground: the strawberries were damaged at delivery and the inspection was recorded on time
- Buyer evidence showing crushed and moisture-damaged cartons
- Supplier evidence showing an intact wrapped pallet before collection
- The supplier's admission that damage was present at delivery
- Policy clause DP-7.3
- Strong evidence sufficiency and direct legal relevance
- The unresolved possibility of a separate carrier claim

**Say:**

> The mediator compared both evidence sets against the agreed inspection terms. The supplier's dispatch photo shows the pallet in good condition before collection, while the buyer's photo shows crushed and wet cartons at receiving. The decisive evidence is the supplier's own admission that the damage was present at delivery.

Continue:

> Clause DP-7.3 makes damaged goods refundable at the purchase-order unit price, but it is subject to DP-7.11. Because the supplier evidenced that these cartons were sound and stretch-wrapped when DHL collected them, the loss is established while its cause is not attributed to either company. DP-7.11 therefore divides the 3.60 USDC equally: 1.80 USDC back to the buyer, 1.80 USDC to the supplier, on top of the 26.40 USDC already released for every accepted item.

> This is the point of anchoring evidence. Both photographs changed the outcome: the buyer's proved the damage, the supplier's proved sound handover. Neither company absorbs a loss it cannot be shown to have caused, and either remains free to recover from the carrier.

If the live proposal differs, say:

> The live model has proposed **[read buyer amount] USDC** back to the buyer and **[read supplier amount] USDC** to the supplier. The important control is that both values add up to the 3.60 USDC still in dispute.

### 13. Both parties approve the same settlement

Have the first party accept the proposal. Switch browsers and have the second party accept it.

**Say:**

> One party cannot impose the AI recommendation. The buyer and supplier must both approve the same allocation before settlement can proceed.

Have each party sign the settlement, then execute it after both signatures are recorded.

**Say:**

> Both companies have now signed the same settlement values. The escrow can execute only that agreed allocation.

### 14. Show the buyer refund

**On screen:** Buyer wallet after settlement.

Refresh the balance if necessary.

Show approximately **13.60 USDC available**.

**Say:**

> After funding, the buyer had 10 USDC left. The settlement returned the full disputed 3.60 USDC, so the available balance is now 13.60 USDC. The supplier receives 26.40 USDC for all accepted goods.

If the live refund differs, say:

> The buyer had 10 USDC after funding. The settlement returned **[read refund] USDC**, producing this new available balance of **[read wallet balance] USDC**.

If the wallet indexer is delayed, show the settlement transaction first and refresh the wallet after a few seconds.

### 15. Close on the complete record

Return to the settled order and show:

- Original PO
- Internal agreement
- Funding and escrow object
- Supplier dispatch photograph
- Delivery note
- Buyer damage photograph
- Supplier response
- AI analysis
- Both approvals
- Settlement transaction

**Say:**

> We began with 40 USDC in the buyer's wallet and a purchase order stored outside the platform. ProofPay converted that order into shared terms, secured 30 USDC, preserved evidence from both sides, isolated a 3.60 USDC dispute, and returned the agreed refund to the buyer.

> Instead of resolving the problem through disconnected emails, screenshots, and manual transfers, both companies now have one private, auditable record from purchase order to settlement.

## Short closing version

Use this if time is nearly finished:

> ProofPay secured 30 USDC before shipment, released the value of every accepted item, held only the 3.60 USDC in dispute, and gave both companies a shared evidence and approval process. The buyer can see the refund back in the wallet, the supplier can verify the escrow independently on Sui, and neither party can impose the final settlement alone.

## Timing guide

| Segment | Time |
|---|---:|
| Background and opening wallet | 1 minute 30 seconds |
| PO, agreement, and order creation | 2 minutes |
| Supplier confirmation and funding | 2 minutes |
| Escrow verification, shipment, and delivery | 2 minutes |
| Inspection and supplier response | 2 minutes |
| AI analysis, approvals, and settlement | 2 minutes 30 seconds |
| Final wallet and close | 1 minute |
| **Total** | **13 minutes** |

## Numbers to remember

| Moment | Buyer available | In escrow | Supplier released |
|---|---:|---:|---:|
| Before funding | 40.00 USDC | 0.00 USDC | 0.00 USDC |
| After funding | 10.00 USDC | 30.00 USDC | 0.00 USDC |
| Partial claim opened | 10.00 USDC | 3.60 USDC disputed | 26.40 USDC |
| Latest case final settlement | 13.60 USDC | 0.00 USDC | 26.40 USDC total |

For a different live AI allocation:

```text
Buyer final wallet = 10.00 + buyer refund
Supplier total received = 26.40 + supplier share of the dispute
Buyer refund + supplier dispute share = 3.60
```
