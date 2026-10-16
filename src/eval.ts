// Runs the rules baseline and the agent over the bank feed, applies the same
// policy to both, and scores against ground truth.
//
// Usage: [DATA_DIR=data RESULTS_DIR=results] node src/eval.ts [--limit N] [--concurrency N] [--rules-only]
// Agent responses are cached in $RESULTS_DIR/agent_cache.json; delete it to re-run.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { agentMatch, buildPrompt, SYSTEM } from "./match/agent.ts";
import { gatherEvidence, type Evidence } from "./match/candidates.ts";
import { decide, DEFAULT_THRESHOLD } from "./match/policy.ts";
import { rulesMatch } from "./match/rules.ts";
import { backend, MODEL } from "./llm.ts";
import type { Action, Customer, GroundTruth, Invoice, Payment, Proposal } from "./types.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const LIMIT = Number(arg("--limit") ?? Infinity);
const CONCURRENCY = Number(arg("--concurrency") ?? 6);
const RULES_ONLY = process.argv.includes("--rules-only");

const load = <T>(f: string): T => JSON.parse(readFileSync(f, "utf8"));
const DATA = process.env.DATA_DIR ?? "data";
const OUT = process.env.RESULTS_DIR ?? "results";
const customers = load<Customer[]>(`${DATA}/customers.json`);
const invoices = load<Invoice[]>(`${DATA}/invoices.json`);
const payments = load<Payment[]>(`${DATA}/payments.json`).slice(0, LIMIT);
const truth = new Map(load<GroundTruth[]>(`${DATA}/ground_truth.json`).map((t) => [t.payment_id, t]));

mkdirSync(OUT, { recursive: true });
const CACHE_FILE = `${OUT}/agent_cache.json`;
type CacheEntry = { key: string; proposal: Proposal; costUsd: number | null; ms: number };
const cache: Record<string, CacheEntry> = existsSync(CACHE_FILE) ? load(CACHE_FILE) : {};

const evidence = new Map<string, Evidence>(payments.map((p) => [p.id, gatherEvidence(p, customers, invoices)]));

// ---- run the agent (cached, bounded concurrency) ----
async function runAgent(): Promise<Map<string, Proposal>> {
  const out = new Map<string, Proposal>();
  const queue = [...payments];
  let done = 0;
  let failures = 0;
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const ev = evidence.get(p.id)!;
      const key = createHash("sha256").update(MODEL + SYSTEM + buildPrompt(p, ev, customers)).digest("hex").slice(0, 16);
      if (cache[p.id]?.key !== key) {
        const t0 = Date.now();
        try {
          const { proposal, costUsd } = await agentMatch(p, ev, customers);
          cache[p.id] = { key, proposal, costUsd, ms: Date.now() - t0 };
          writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
        } catch (e) {
          failures++;
          console.error(`\n${p.id} failed: ${(e as Error).message}`);
          continue;
        }
      }
      out.set(p.id, cache[p.id].proposal);
      process.stdout.write(`\ragent ${++done}/${payments.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  if (failures) console.error(`${failures} agent calls failed; they count as "review" with no suggestion.`);
  return out;
}

// ---- scoring ----
type Outcome = "correct_auto" | "wrong_auto" | "skipped" | "review_good_suggestion" | "review_shortlist" | "review_no_good_suggestion";

const idSet = (p: Proposal) => [...new Set(p.allocations.map((a) => a.invoice_id))].sort().join(",");
const truthSet = (t: GroundTruth) => [...new Set(t.allocations.map((a) => a.invoice_id))].sort().join(",");

function outcome(a: Action, t: GroundTruth): Outcome {
  const right = t.ideal === "no_invoice" ? a.proposal.decision === "not_invoice_payment" : idSet(a.proposal) === truthSet(t);
  // An auto-apply must also get the residual right: writing off a real balance as a "fee" is an error.
  const residualOk = a.proposal.residual === t.residual;
  if (a.action === "auto_apply") return t.ideal !== "no_invoice" && right && residualOk ? "correct_auto" : "wrong_auto";
  if (a.action === "leave_unmatched") return t.ideal === "no_invoice" ? "correct_auto" : "skipped";
  if (right) return "review_good_suggestion";
  // "Can't tell, it's one of these" is the best possible answer for a truly ambiguous payment.
  const shortlist = new Set([...a.proposal.allocations.map((x) => x.invoice_id), ...a.proposal.alternatives]);
  if (t.allocations.length && t.allocations.every((x) => shortlist.has(x.invoice_id))) return "review_shortlist";
  return "review_no_good_suggestion";
}

// Minutes of human work per payment. Assumptions, stated in the report; tune them.
const MINUTES: Record<Outcome, number> = {
  correct_auto: 0,
  review_good_suggestion: 0.25, // glance and confirm
  review_shortlist: 1, // pick from a short list, maybe check the deposit image
  review_no_good_suggestion: 3, // hunt for it by hand
  skipped: 3, // found later, reconciled by hand
  wrong_auto: 20, // notice, unwind, fix the customer's balance, maybe apologize
};
const MANUAL_MINUTES = 3; // status quo: every payment matched by hand

type Score = { n: number; counts: Record<Outcome, number>; minutes: number; autoRate: number; autoPrecision: number; idealAutoCoverage: number };

function score(actions: Action[]): Score {
  const counts: Record<Outcome, number> = { correct_auto: 0, wrong_auto: 0, skipped: 0, review_good_suggestion: 0, review_shortlist: 0, review_no_good_suggestion: 0 };
  let idealAuto = 0;
  let idealAutoHandled = 0;
  for (const a of actions) {
    const t = truth.get(a.payment_id)!;
    const o = outcome(a, t);
    counts[o]++;
    if (t.ideal === "auto") (idealAuto++, o === "correct_auto" && idealAutoHandled++);
  }
  const n = actions.length;
  const autos = counts.correct_auto + counts.wrong_auto;
  return {
    n,
    counts,
    minutes: (Object.keys(counts) as Outcome[]).reduce((s, k) => s + counts[k] * MINUTES[k], 0),
    autoRate: counts.correct_auto / n,
    autoPrecision: autos ? counts.correct_auto / autos : 1,
    idealAutoCoverage: idealAuto ? idealAutoHandled / idealAuto : 0,
  };
}

const actionsFor = (props: Map<string, Proposal>, threshold: number): Action[] =>
  payments.map((p) => {
    const prop = props.get(p.id) ?? { payment_id: p.id, decision: "unsure" as const, allocations: [], residual: "none" as const, confidence: 0, reasoning: "Agent call failed.", alternatives: [] };
    return decide(p, prop, evidence.get(p.id)!, invoices, threshold);
  });

// ---- main ----
const rulesProps = new Map(payments.map((p) => [p.id, rulesMatch(p, evidence.get(p.id)!)]));
const agentProps = RULES_ONLY ? new Map<string, Proposal>() : await runAgent();

const rulesActions = actionsFor(rulesProps, DEFAULT_THRESHOLD);
const agentActions = actionsFor(agentProps, DEFAULT_THRESHOLD);
const rulesScore = score(rulesActions);
const agentScore = score(agentActions);

function calibration() {
  const bands: [string, number, number][] = [["< 0.70", 0, 0.7], ["0.70 - 0.89", 0.7, 0.9], ["0.90 - 0.94", 0.9, 0.95], [">= 0.95", 0.95, 1.01]];
  return bands.map(([label, lo, hi]) => {
    const xs = payments.map((p) => ({ p: agentProps.get(p.id), t: truth.get(p.id)! })).filter(({ p }) => p && p.decision !== "unsure" && p.confidence >= lo && p.confidence < hi);
    const right = xs.filter(({ p, t }) => (t.ideal === "no_invoice" ? p!.decision === "not_invoice_payment" : idSet(p!) === truthSet(t) && p!.residual === t.residual)).length;
    return { label, n: xs.length, right };
  });
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const hrs = (m: number) => `${(m / 60).toFixed(1)} h`;
const row = (name: string, s: Score) =>
  `| ${name} | ${pct(s.autoRate)} | ${s.counts.wrong_auto} | ${s.counts.review_good_suggestion + s.counts.review_shortlist + s.counts.review_no_good_suggestion} | ${s.counts.review_good_suggestion} | ${s.counts.review_shortlist} | ${s.counts.skipped} | ${hrs(s.minutes)} |`;

const scenarios = [...new Set(payments.map((p) => truth.get(p.id)!.scenario))];
const byScenario = (actions: Action[], sc: string) => {
  const xs = actions.filter((a) => truth.get(a.payment_id)!.scenario === sc);
  const s = score(xs);
  return `${s.counts.correct_auto}/${s.n} auto` + (s.counts.wrong_auto ? `, **${s.counts.wrong_auto} wrong**` : "") + (s.counts.review_good_suggestion ? `, ${s.counts.review_good_suggestion} review (good guess)` : "") + (s.counts.review_shortlist ? `, ${s.counts.review_shortlist} review (shortlist)` : "");
};

const thresholds = [0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 0.98];
// Ablation: the model's own call, with only the confidence bar and no reconciliation guardrails.
const naiveActions = (props: Map<string, Proposal>, threshold: number): Action[] =>
  payments.map((p) => {
    const prop = props.get(p.id)!;
    const action = prop.confidence < threshold || prop.decision === "unsure" ? "review" : prop.decision === "match" ? "auto_apply" : "leave_unmatched";
    return { payment_id: p.id, action, proposal: prop, why: "naive" };
  });
const sweep = RULES_ONLY
  ? []
  : thresholds.map((th) => ({ th, s: score(actionsFor(agentProps, th)), naive: score(naiveActions(agentProps, th)) }));

const costs = Object.values(cache).filter((c) => payments.some((p) => p.id && cache[p.id] === c));
const totalCost = costs.reduce((s, c) => s + (c.costUsd ?? 0), 0);
const avgMs = costs.length ? costs.reduce((s, c) => s + c.ms, 0) / costs.length : 0;

const report = `# Eval results

${payments.length} incoming payments against ${invoices.length} open invoices across ${customers.length} customers. Synthetic data from \`${DATA}/\`. Model: \`${MODEL}\` via ${backend()}. Policy threshold: ${DEFAULT_THRESHOLD}.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | ${payments.length} | 0 | 0 | 0 | ${hrs(payments.length * MANUAL_MINUTES)} |
${row("Rules baseline", rulesScore)}
${RULES_ONLY ? "" : row("Agent + policy", agentScore)}

- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes ${MANUAL_MINUTES} min to match a payment by hand, ${MINUTES.review_good_suggestion} min to confirm a correct suggestion, ${MINUTES.review_shortlist} min to pick from a shortlist, ${MINUTES.wrong_auto} min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
${RULES_ONLY ? "" : `- Of the ${payments.filter((p) => truth.get(p.id)!.ideal === "auto").length} payments a careful human would apply without hesitation, rules handle ${pct(rulesScore.idealAutoCoverage)} and the agent handles ${pct(agentScore.idealAutoCoverage)}.`}

## By scenario

| Scenario | Count | Rules | Agent |
|---|---|---|---|
${scenarios.map((sc) => `| ${sc} | ${payments.filter((p) => truth.get(p.id)!.scenario === sc).length} | ${byScenario(rulesActions, sc)} | ${RULES_ONLY ? "-" : byScenario(agentActions, sc)} |`).join("\n")}

${RULES_ONLY ? "" : `## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
${sweep.map(({ th, s, naive }) => `| ${th} | ${pct(s.autoRate)} | ${s.counts.wrong_auto} | ${s.counts.review_good_suggestion + s.counts.review_shortlist + s.counts.review_no_good_suggestion} | ${hrs(s.minutes)} | ${pct(naive.autoRate)} / ${naive.counts.wrong_auto} |`).join("\n")}

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in \`policy.ts\` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
${calibration().map((b) => `| ${b.label} | ${b.n} | ${b.n ? pct(b.right / b.n) : "-"} |`).join("\n")}

## Agent errors and near misses

${agentActions
  .filter((a) => ["wrong_auto", "skipped", "review_no_good_suggestion"].includes(outcome(a, truth.get(a.payment_id)!)))
  .map((a) => {
    const t = truth.get(a.payment_id)!;
    return `- **${a.payment_id}** (${t.scenario}, ${outcome(a, truth.get(a.payment_id)!)}): expected ${truthSet(t) || "no invoice"}, agent proposed ${idSet(a.proposal) || a.proposal.decision} at ${a.proposal.confidence.toFixed(2)}. Agent: "${a.proposal.reasoning}" Policy: ${a.why}`;
  })
  .join("\n") || "None."}

## Cost and latency

${costs.length} agent calls, ${totalCost ? `$${totalCost.toFixed(2)} total at list price ($${(totalCost / costs.length).toFixed(3)} per payment)` : "cost not reported by this backend"}, average ${(avgMs / 1000).toFixed(1)} s per call.
`}`;

writeFileSync(`${OUT}/report.md`, report);
writeFileSync(
  `${OUT}/run.json`,
  JSON.stringify(
    {
      model: MODEL,
      threshold: DEFAULT_THRESHOLD,
      generated: new Date().toISOString(),
      rules: rulesScore,
      agent: RULES_ONLY ? null : agentScore,
      sweep,
      actions: agentActions.map((a) => ({ ...a, outcome: outcome(a, truth.get(a.payment_id)!), truth: truth.get(a.payment_id) })),
      rulesActions: rulesActions.map((a) => ({ ...a, outcome: outcome(a, truth.get(a.payment_id)!) })),
    },
    null,
    2,
  ),
);
console.log(report.split("## By scenario")[0]);
