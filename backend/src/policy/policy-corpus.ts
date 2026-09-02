import { readFile } from "node:fs/promises";

export interface PolicyClause {
  /** Stable citation identifier, e.g. "DP-7.3". */
  id: string;
  /** Section heading the clause sits under, for display only. */
  section: string;
  /** Plain text of the clause. Quotes are validated verbatim against this. */
  text: string;
}

export interface PolicyCorpus {
  version: string;
  clauses: PolicyClause[];
}

/** Markdown emphasis is presentation; quotes must match the words a reader sees. */
function plainText(value: string): string {
  return value.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|[^*])\*([^*]+)\*/g, "$1$2").replace(/\s+/g, " ").trim();
}

export function parsePolicyClauses(markdown: string): PolicyCorpus {
  const version = /\*\*Version\s+([0-9.]+)/.exec(markdown)?.[1] ?? "0";
  const clauses: PolicyClause[] = [];
  let section = "";
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.*)$/.exec(line.trim());
    if (heading) { section = plainText(heading[1]!); continue; }
    const clause = /^\*\*(DP-\d+\.\d+)\*\*\s+(.+)$/.exec(line.trim());
    if (clause) clauses.push({ id: clause[1]!, section, text: plainText(clause[2]!) });
  }
  return { version, clauses };
}

export async function loadPolicyCorpus(file: string): Promise<PolicyCorpus> {
  const corpus = parsePolicyClauses(await readFile(file, "utf8"));
  if (!corpus.clauses.length) throw new Error(`No dispute policy clauses found in ${file}`);
  return corpus;
}

/**
 * Clauses the parties' own agreement contributes, as quotable authority. Trade
 * terms are the first authority; the policy fills the gaps they leave.
 */
export function agreementClauses(terms: Record<string, string | undefined>): PolicyClause[] {
  const labels: Record<string, string> = {
    description: "Order description",
    inspectionTerms: "Inspection",
    acceptanceTerms: "Acceptance",
    remedyTerms: "Remedies",
    deliveryTerms: "Delivery",
    governingLaw: "Governing law",
  };
  const clauses: PolicyClause[] = [];
  for (const [key, label] of Object.entries(labels)) {
    const value = terms[key]?.trim();
    if (value) clauses.push({ id: `AGREEMENT-${clauses.length + 1}`, section: label, text: plainText(value) });
  }
  return clauses;
}
