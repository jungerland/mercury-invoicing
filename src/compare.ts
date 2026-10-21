// Compares models and routing strategies from cached agent answers. No model calls.
// Opus answers come from results/{,seed7,seed99}; other models from results/models/<model>/<seed>.
// Each strategy runs every payment through the same policy and scoring as eval.ts.
//
// Usage: node src/compare.ts   (writes results/models/report.md)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gatherEvidence, type Evidence } from "./match/candidates.ts";
import { decide, DEFAULT_THRESHOLD } from "./match/policy.ts";
import { builtinMatch } from "./match/builtin.ts";
import { rulesMatch } from "./match/rules.ts";
import { PRICES, type Usage } from "./llm.ts";
import type { Action, Customer, GroundTruth, Invoice, Payment, Proposal } from "./types.ts";

const load = <T>(f: string): T => JSON.parse(readFileSync(f, "utf8"));
const SEEDS = [
  { name: "seed42", data: "data", opus: "results" },
  { name: "seed7", data: "data/seed7", opus: "results/seed7" },
  { name: "seed99", data: "data/seed99", opus: "results/seed99" },
];
const MODELS = ["opus", "sonnet", "haiku"] as const;
type Model = (typeof MODELS)[number];
type Entry = { proposal: Proposal; usage: Usage };

// Same scoring as eval.ts.
const MINUTES = { correct_auto: 0, review_good_suggestion: 0.25, review_shortlist: 1, review_no_good_suggestion: 3, skipped: 3, wrong_auto: 20 };
type Outcome = keyof typeof MINUTES;
const idSet = (p: Proposal) => [...new Set(p.allocations.map((a) => a.invoice_id))].sort().join(",");
const truthSet = (t: GroundTruth) => [...new Set(t.allocations.map((a) => a.invoice_id))].sort().join(",");
const isRight = (p: Proposal, t: GroundTruth) => (t.ideal === "no_invoice" ? p.decision === "not_invoice_payment" : idSet(p) === truthSet(t) && p.residual === t.residual);
function outcome(a: Action, t: GroundTruth): Outcome {
  const right = t.ideal === "no_invoice" ? a.proposal.decision === "not_invoice_payment" : idSet(a.proposal) === truthSet(t);
  if (a.action === "auto_apply") return t.ideal !== "no_invoice" && right && a.proposal.residual === t.residual ? "correct_auto" : "wrong_auto";
  if (a.action === "leave_unmatched") return t.ideal === "no_invoice" ? "correct_auto" : "skipped";
  if (right) return "review_good_suggestion";
  const shortlist = new Set([...a.proposal.allocations.map((x) => x.invoice_id), ...a.proposal.alternatives]);
  return t.allocations.length && t.allocations.every((x) => shortlist.has(x.invoice_id)) ? "review_shortlist" : "review_no_good_suggestion";
}

// Production cost of one call: the CLI's cache writes count as plain input, since production
// would cache only the shared system prompt (same convention as the demo page).
const callCost = (m: Model, u: Usage) => {
  const p = PRICES[`claude-${m}-5-5`];
  return ((u.input + u.cache_write_5m + u.cache_write_1h) * p.input + u.cache_read * p.cache_read + u.output * p.output) / 1e6;
};

type Pay = { p: Payment; t: GroundTruth; ev: Evidence; invoices: Invoice[]; answers: Partial<Record<Model, Entry>> };
const pays: (Pay & { seed: string })[] = [];
const have = new Set<Model>(MODELS);
for (const s of SEEDS) {
  const customers = load<Customer[]>(`${s.data}/customers.json`);
  const invoices = load<Invoice[]>(`${s.data}/invoices.json`);
  const truth = new Map(load<GroundTruth[]>(`${s.data}/ground_truth.json`).map((t) => [t.payment_id, t]));
  const caches: Partial<Record<Model, Record<string, Entry>>> = {};
  for (const m of MODELS) {
    const f = m === "opus" ? `${s.opus}/agent_cache.json` : `results/models/${m}/${s.name}/agent_cache.json`;
    if (existsSync(f)) caches[m] = load(f);
  }
  const payments = load<Payment[]>(`${s.data}/payments.json`);
  for (const m of MODELS) if (!caches[m] || payments.some((p) => !caches[m]![p.id]?.usage)) have.delete(m);
  for (const p of payments) {
    const answers: Pay["answers"] = {};
    for (const m of MODELS) if (caches[m]?.[p.id]) answers[m] = caches[m]![p.id];
    pays.push({ seed: s.name, p, t: truth.get(p.id)!, ev: gatherEvidence(p, customers, invoices), invoices, answers });
  }
}

// A strategy is a list of steps tried in order. A step either settles the payment (auto-apply or
// leave alone) or passes it on; the last step's answer goes to review if nothing settled it.
// A model step may carry its own bar, e.g. "haiku@0.8".
type Step = "builtin" | "rules" | Model | `${Model}@${number}`;
type Result = { n: number; counts: Record<Outcome, number>; minutes: number; calls: Partial<Record<Model, number>>; cost: number };

function run(steps: Step[], th = DEFAULT_THRESHOLD, guardrails = true, only = pays): Result {
  const counts = Object.fromEntries(Object.keys(MINUTES).map((k) => [k, 0])) as Record<Outcome, number>;
  const calls: Result["calls"] = {};
  let cost = 0;
  for (const x of only) {
    let last: Action | undefined;
    for (const step of steps) {
      let a: Action;
      if (step === "builtin") {
        const prop = builtinMatch(x.p, x.invoices);
        // On its own, built-in leaves everything it can't match alone, as in eval.ts.
        a = { payment_id: x.p.id, action: prop.decision === "match" ? "auto_apply" : steps.length === 1 ? "leave_unmatched" : "review", proposal: prop, why: "" };
      } else if (step === "rules") {
        a = decide(x.p, rulesMatch(x.p, x.ev), x.ev, x.invoices, th);
      } else {
        const [m, bar] = step.split("@") as [Model, string?];
        const e = x.answers[m]!;
        calls[m] = (calls[m] ?? 0) + 1;
        cost += callCost(m, e.usage);
        a = guardrails ? decide(x.p, e.proposal, x.ev, x.invoices, bar ? Number(bar) : th) : naive(x.p.id, e.proposal, bar ? Number(bar) : th);
      }
      // Built-in and rules suggestions are weak; keep the latest model suggestion for the reviewer.
      if (step !== "builtin" && step !== "rules") last = a;
      else last ??= a;
      if (a.action !== "review") { last = a; break; }
    }
    counts[outcome(last!, x.t)]++;
  }
  const minutes = (Object.keys(counts) as Outcome[]).reduce((s, k) => s + counts[k] * MINUTES[k], 0);
  return { n: only.length, counts, minutes, calls, cost };
}
const naive = (id: string, prop: Proposal, th: number): Action => ({
  payment_id: id,
  action: prop.confidence < th || prop.decision === "unsure" ? "review" : prop.decision === "match" ? "auto_apply" : "leave_unmatched",
  proposal: prop,
  why: "",
});

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const usd = (x: number, d = 4) => `$${x.toFixed(d)}`;
const NAMES: Record<string, string> = { builtin: "Built-in", rules: "Rules", opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };
const label = (s: Step[]) => s.map((x) => { const [m, bar] = x.split("@"); return NAMES[m] + (bar ? ` (bar ${bar})` : ""); }).join(" → ");
const callsText = (r: Result) => (Object.entries(r.calls) as [Model, number][]).map(([m, c]) => `${m} ${pct(c / r.n)}`).join(", ") || "none";
const row = (steps: Step[], th = DEFAULT_THRESHOLD) => {
  const r = run(steps, th);
  const bySeed = SEEDS.map((s) => pct(run(steps, th, true, pays.filter((x) => x.seed === s.name)).counts.correct_auto / (pays.length / 3)));
  return `| ${label(steps)} | ${pct(r.counts.correct_auto / r.n)} | ${bySeed.join(" / ")} | ${r.counts.wrong_auto} | ${(r.minutes / 60 / SEEDS.length).toFixed(2)} h | ${callsText(r)} | ${usd(r.cost / r.n)} |`;
};

const models = MODELS.filter((m) => have.has(m));
const strategies: Step[][] = [["builtin"], ["builtin", "rules"]];
for (const m of models) strategies.push([m], ["builtin", m], ["builtin", "rules", m]);
if (have.has("haiku")) strategies.push(["haiku@0.8"], ["builtin", "rules", "haiku@0.8"]);
if (have.has("haiku") && have.has("opus")) strategies.push(["builtin", "haiku", "opus"], ["builtin", "rules", "haiku", "opus"], ["builtin", "rules", "haiku@0.8", "opus"]);
if (have.has("sonnet") && have.has("opus")) strategies.push(["builtin", "rules", "sonnet", "opus"]);

const calibration = (m: Model) =>
  [["< 0.70", 0, 0.7], ["0.70 - 0.89", 0.7, 0.9], ["0.90 - 0.94", 0.9, 0.95], [">= 0.95", 0.95, 1.01]].map(([lbl, lo, hi]) => {
    const xs = pays.filter((x) => { const p = x.answers[m]!.proposal; return p.decision !== "unsure" && p.confidence >= (lo as number) && p.confidence < (hi as number); });
    const right = xs.filter((x) => isRight(x.answers[m]!.proposal, x.t)).length;
    return `${xs.length ? `${right}/${xs.length}` : "-"}`;
  });

const tokens = (m: Model) => {
  const us = pays.map((x) => x.answers[m]!.usage);
  const avg = (f: (u: Usage) => number) => Math.round(us.reduce((s, u) => s + f(u), 0) / us.length);
  return `${avg((u) => u.input + u.cache_write_5m + u.cache_write_1h + u.cache_read)} in, ${avg((u) => u.output)} out`;
};

const report = `# Model and routing comparison

${pays.length} payments across ${SEEDS.length} test sets (${SEEDS.map((s) => s.name).join(", ")}). Policy bar ${DEFAULT_THRESHOLD}, guardrails on. Models: ${models.join(", ")}.
Generated by \`node src/compare.ts\` from cached answers; no model calls.

Each strategy tries its steps in order. A step either settles a payment (auto-apply, or leave alone as not an invoice payment) or passes it to the next step; whatever is left goes to a person with the last model's suggestion. "Built-in" is virtual account plus exact amount. "Rules" is the rules baseline under the same guardrails.

Cost is per payment at list price, assuming production caching (shared system prompt only), so it runs below the CLI's billed cost.

## Strategies

| Strategy | Hands-off | By set (42 / 7 / 99) | Wrong auto-applies | Human time per 99 | Payments sent to each model | Model cost per payment |
|---|---|---|---|---|---|---|
${strategies.map((s) => row(s)).join("\n")}

## Per model, all payments

| Model | Hands-off at 0.90 | Hands-off at 0.80 | Wrong at 0.80 | Without guardrails at 0.90: hands-off / wrong | Without guardrails at 0.50: wrong | Avg tokens per call | Cost per call |
|---|---|---|---|---|---|---|---|
${models.map((m) => {
  const a = run([m]), b = run([m], 0.8), n9 = run([m], 0.9, false), n5 = run([m], 0.5, false);
  return `| ${m} | ${pct(a.counts.correct_auto / a.n)} | ${pct(b.counts.correct_auto / b.n)} | ${b.counts.wrong_auto} | ${pct(n9.counts.correct_auto / n9.n)} / ${n9.counts.wrong_auto} | ${n5.counts.wrong_auto} | ${tokens(m)} | ${usd(a.cost / a.n)} |`;
}).join("\n")}

## Calibration (exactly right / proposals, by confidence)

| Model | < 0.70 | 0.70 - 0.89 | 0.90 - 0.94 | >= 0.95 |
|---|---|---|---|---|
${models.map((m) => `| ${m} | ${calibration(m).join(" | ")} |`).join("\n")}
`;

writeFileSync("results/models/report.md", report);
console.log(report);
