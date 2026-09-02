/**
 * Live check of the agreement/policy mediation path using fabricated evidence
 * transcripts in place of real uploads. Prints the full structured output so
 * the shape of each side's case and the mediator's determination can be judged.
 */
import { MediationOrchestrator } from "../src/ai/mediation.js";
import { config } from "../src/config.js";
import { openDispute, supplierRespond } from "../src/domain/dispute-machine.js";
import type { DisputeAggregate } from "../src/domain/types.js";
import { GeminiJsonModel } from "../src/integrations/gemini.js";
import { loadPolicyCorpus } from "../src/policy/policy-corpus.js";
import { systemContext } from "../src/service/dispute-service.js";

const BUYER = "11111111-1111-4111-8111-111111111111";
const SUPPLIER = "22222222-2222-4222-8222-222222222222";
const ARBITRATOR = "33333333-3333-4333-8333-333333333333";
const buyer = { id: BUYER };
const supplier = { id: SUPPLIER };

// 100 cartons at 300 USDC (6dp) = 30,000,000,000 units. 13 cartons = 3,900,000,000.
const receivingNote = `RECEIVING NOTE RN-8841
Consignment: PO-2471, 100 cartons cooking oil 5L
Received at GreenBite receiving dock on 29 August 2026, 09:14
Checked by: R. Tan, warehouse supervisor
Cartons received: 100
Cartons accepted: 87
Cartons rejected: 13 - crushed corners, seals split, product leaking onto pallet
Photographs: IMG_4471 to IMG_4478 taken at bay 2 before unloading completed
Carrier representative present: yes, signed`;

const photoTranscript = `Photograph IMG_4473. A stack of cardboard cartons on a wooden pallet under warehouse lighting.
Visible carton label text: "COOKING OIL 5L x 12" and "PO-2471".
Two cartons in the middle of the stack show collapsed side walls; the seam of the upper carton is split along its length.
A dark liquid film is visible on the pallet boards beneath the stack.
No date is printed on the image.`;

const dispatchTranscript = `PRE-DISPATCH CHECK SHEET
Order: PO-2471, cooking oil 5L, 100 cartons
Date: 27 August 2026
Loading bay: FreshSource Foods, Klang
Pallet wrap: applied, 4 layers
Cartons loaded: 100, all seals intact at loading, spot check of 10 cartons found no damage
Signed: A. Rahman, dispatch supervisor
Carrier: Peninsular Haulage, driver signed clean receipt at collection`;

let dispute: DisputeAggregate = openDispute({
  orderId: "PO-2471", buyerId: BUYER, supplierId: SUPPLIER, arbitratorId: ARBITRATOR,
  assetType: "Testnet USDC",
  totalEscrowUnits: "30000000000",
  disputedUnits: "3900000000",
  requestedBuyerUnits: "3900000000",
  claim: "13 of 100 cartons arrived crushed and leaking. The buyer accepted 87 cartons and asks for a refund of the 13 damaged cartons at the agreed unit price.",
  tradeTerms: {
    orderReference: "PO-2471",
    description: "100 cartons of cooking oil 5L at 300 Testnet USDC per carton, delivered to GreenBite receiving dock.",
    inspectionTerms: "The buyer inspects the consignment on arrival and records accepted, missing and damaged quantities on a receiving note.",
    acceptanceTerms: "Cartons recorded as accepted on the receiving note are accepted by the buyer.",
    remedyTerms: "",
    governingLaw: "Malaysia",
  },
  negotiationDeadline: "2026-09-09T00:00:00.000Z",
  maxHumanRounds: 3,
  evidenceStatement: "Our warehouse supervisor checked the consignment on arrival and rejected 13 cartons that were crushed and leaking. Photographs were taken at the bay before unloading finished.",
  evidenceFiles: [
    { storagePath: "evidence/rn-8841.pdf", sha256: "a".repeat(64), mimeType: "application/pdf", sizeBytes: 184_320, transcript: receivingNote },
    { storagePath: "evidence/img_4473.jpg", sha256: "b".repeat(64), mimeType: "image/jpeg", sizeBytes: 2_204_160, transcript: photoTranscript },
    // Deliberately unread: the analysis must not describe this one.
    { storagePath: "evidence/img_4478.jpg", sha256: "c".repeat(64), mimeType: "image/jpeg", sizeBytes: 2_101_004 },
  ],
}, buyer, systemContext);

dispute = supplierRespond(dispute, supplier, {
  agrees: false,
  statement: "All 100 cartons were sealed and intact when they left our loading bay, and the carrier signed a clean receipt. Any crushing happened in transit or during unloading, which is not our responsibility.",
  files: [
    { storagePath: "evidence/dispatch-check.pdf", sha256: "d".repeat(64), mimeType: "application/pdf", sizeBytes: 96_000, transcript: dispatchTranscript },
  ],
}, systemContext);

const policy = await loadPolicyCorpus(config.disputePolicyFile);
console.log(`Policy v${policy.version}: ${policy.clauses.length} clauses\n`);

const started = Date.now();
const result = await new MediationOrchestrator(
  new GeminiJsonModel(config.geminiApiKey(), config.geminiModel), policy, systemContext,
).mediate(dispute);

const money = (value: string) => `${(Number(value) / 1e6).toLocaleString("en-US")} USDC`;
const line = (label: string) => console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);

console.log(`outcome=${result.outcome} rounds=${result.debateRounds} calls=${result.modelCalls} elapsed=${((Date.now() - started) / 1000).toFixed(1)}s`);
console.log(`run outcome=${result.run.outcome} issues=${JSON.stringify(result.run.validationIssues)}`);

for (const side of ["buyerFinal", "supplierFinal"] as const) {
  const advocate = result.run[side];
  if (!advocate) continue;
  line(`${side === "buyerFinal" ? "BUYER" : "SUPPLIER"} ADVOCATE`);
  console.log(`Position: refund ${money(advocate.recommendedBuyerRefundUnits)} to buyer, release ${money(advocate.recommendedSupplierReleaseUnits)} to supplier`);
  console.log(`\nIssues:\n${advocate.issues.map((item) => `  - ${item}`).join("\n")}`);
  console.log(`\nEvidence relied on:\n${advocate.evidenceBasis.map((item) => `  [${item.evidenceId}] "${item.quote}"`).join("\n")}`);
  console.log(`\nAgreement terms:\n${advocate.contractBasis.map((item) => `  [${item.clauseId}] "${item.quote}"`).join("\n") || "  (none)"}`);
  console.log(`\nPolicy clauses:\n${advocate.policyBasis.map((item) => `  [${item.clauseId}] "${item.quote}"`).join("\n") || "  (none)"}`);
  console.log(`\nApplication:\n  ${advocate.application}`);
  console.log(`\nConcessions:\n${advocate.concessions.map((item) => `  - ${item}`).join("\n") || "  (none)"}`);
  console.log(`\nOpen questions:\n${advocate.unresolvedQuestions.map((item) => `  - ${item}`).join("\n") || "  (none)"}`);
}

line("MEDIATOR DETERMINATION");
const mediator = result.run.mediatorFinal;
if (mediator) {
  console.log(`Outcome: ${mediator.outcome}`);
  console.log(`\nCommon ground:\n${mediator.commonGround.map((item) => `  - ${item}`).join("\n") || "  (none)"}`);
  console.log(`\nFindings:`);
  for (const finding of mediator.findings) {
    console.log(`  Issue: ${finding.issue}`);
    console.log(`  Finding: ${finding.finding}`);
    console.log(`  Support: ${finding.supportingEvidence.map((item) => `[${item.evidenceId}] "${item.quote}"`).join("; ") || "none quoted"}\n`);
  }
  console.log(`Agreement terms applied:\n${mediator.contractBasis.map((item) => `  [${item.clauseId}] "${item.quote}"`).join("\n") || "  (none)"}`);
  console.log(`\nPolicy clauses applied:\n${mediator.policyBasis.map((item) => `  [${item.clauseId}] "${item.quote}"`).join("\n") || "  (none)"}`);
  if (mediator.outcome === "proposal") {
    console.log(`\nReasoning:\n  ${mediator.reasoning}`);
    console.log(`\nDetermination: refund ${money(mediator.buyerRefundUnits)} to buyer, release ${money(mediator.supplierReleaseUnits)} to supplier`);
    console.log(`Evidence sufficiency: ${mediator.evidenceSufficiency} | rule fit: ${mediator.legalRelevance}`);
  } else {
    console.log(`\nAbstained because: ${mediator.reason}`);
  }
  console.log(`\nOpen questions:\n${mediator.unresolvedQuestions.map((item) => `  - ${item}`).join("\n") || "  (none)"}`);
}

if (result.outcome === "proposal") {
  line("STORED PROPOSAL (what the parties see)");
  console.log(result.proposal.summary);
  console.log(`\n${result.proposal.reasoning}`);
  console.log(`\nCitations:\n${result.proposal.citations.map((item) => `  [${item.passageId}] ${item.title} — ${item.locator}`).join("\n")}`);
}

const transcriptText = JSON.stringify(result.run);
if (transcriptText.includes("IMG_4478")) throw new Error("Analysis referenced a file that was never read");
console.log("\nCheck: no reference to the unread file IMG_4478.");
