import { describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import { agreementClauses, loadPolicyCorpus, parsePolicyClauses } from "../src/policy/policy-corpus.js";

describe("dispute policy corpus", () => {
  it("parses the published policy into quotable clauses", async () => {
    const corpus = await loadPolicyCorpus(config.disputePolicyFile);
    expect(corpus.version).toBe("1.0");
    expect(corpus.clauses.length).toBeGreaterThan(50);
    for (const clause of corpus.clauses) {
      expect(clause.id).toMatch(/^DP-\d+\.\d+$/);
      expect(clause.section).toMatch(/^DP-\d+/);
      // Emphasis markers would break verbatim quoting against the rendered text.
      expect(clause.text).not.toContain("**");
      expect(clause.text.length).toBeGreaterThan(20);
    }
    const abstention = corpus.clauses.find((clause) => clause.id === "DP-7.10");
    expect(abstention?.text).toContain("no proposal is made");
    expect(corpus.clauses.find((clause) => clause.id === "DP-6.3")?.text)
      .toContain("can never exceed the amount the buyer requested");
  });

  it("keeps clause identifiers unique so citations resolve to one clause", async () => {
    const corpus = await loadPolicyCorpus(config.disputePolicyFile);
    expect(new Set(corpus.clauses.map((clause) => clause.id)).size).toBe(corpus.clauses.length);
  });

  it("ignores prose that is not a numbered clause", () => {
    const corpus = parsePolicyClauses([
      "**Version 2.1 · Effective 1 January 2027**",
      "## DP-1 · Scope",
      "Some introductory prose that is not a clause.",
      "**DP-1.1** The first clause.",
      "- a bullet that is not a clause",
    ].join("\n"));
    expect(corpus.version).toBe("2.1");
    expect(corpus.clauses).toEqual([{ id: "DP-1.1", section: "DP-1 · Scope", text: "The first clause." }]);
  });

  it("turns the parties' own trade terms into numbered agreement clauses", () => {
    const clauses = agreementClauses({
      description: "100 cartons of cooking oil",
      inspectionTerms: "Buyer inspects within seven days of delivery.",
      acceptanceTerms: "",
      governingLaw: "Malaysia",
    });
    expect(clauses).toEqual([
      { id: "AGREEMENT-1", section: "Order description", text: "100 cartons of cooking oil" },
      { id: "AGREEMENT-2", section: "Inspection", text: "Buyer inspects within seven days of delivery." },
      { id: "AGREEMENT-3", section: "Governing law", text: "Malaysia" },
    ]);
  });
});
