// Bakes eval results into the static review-queue page: ui/template.html -> ui/index.html.
// For each payment it stores the agent's proposal plus whether the code guardrails
// would allow an auto-apply, so the page can recompute outcomes at any threshold.
//
// Usage: node src/build-ui.ts   (run after `npm run eval`)

import { readFileSync, writeFileSync } from "node:fs";
import { gatherEvidence } from "./match/candidates.ts";
import { decide } from "./match/policy.ts";
import type { Customer, GroundTruth, Invoice, Payment, Proposal } from "./types.ts";

const load = <T>(f: string): T => JSON.parse(readFileSync(f, "utf8"));
const customers = load<Customer[]>("data/customers.json");
const invoices = load<Invoice[]>("data/invoices.json");
const payments = load<Payment[]>("data/payments.json");
const truth = new Map(load<GroundTruth[]>("data/ground_truth.json").map((t) => [t.payment_id, t]));
const cache = load<Record<string, { proposal: Proposal }>>("results/agent_cache.json");
const run = load<{ rules: unknown; agent: unknown; actions: { payment_id: string; action: string }[]; rulesActions: { payment_id: string; action: string; outcome: string; why: string }[]; builtinActions: { payment_id: string; action: string; outcome: string }[] }>("results/run.json");
const seed7 = load<{ builtin: unknown; rules: unknown; agent: unknown; sweep: unknown }>("results/seed7/run.json");

const custName = new Map(customers.map((c) => [c.id, c.name]));
const inv = (id: string) => {
  const i = invoices.find((x) => x.id === id);
  return i ? { id, number: i.number, customer: custName.get(i.customer_id)!, amount: i.amount, due: i.due } : { id, number: id, customer: "?", amount: 0, due: "" };
};

const rows = payments.map((p) => {
  const prop = cache[p.id].proposal;
  const ev = gatherEvidence(p, customers, invoices);
  const atZero = decide(p, prop, ev, invoices, 0); // threshold 0 isolates the code guardrails
  const t = truth.get(p.id)!;
  const rules = run.rulesActions.find((r) => r.payment_id === p.id)!;
  const builtin = run.builtinActions.find((r) => r.payment_id === p.id)!;
  return {
    ...p,
    proposal: { ...prop, allocations: prop.allocations.map((a) => ({ ...a, ...inv(a.invoice_id), applied: a.amount })), alternatives: prop.alternatives.map(inv) },
    guardrails_ok: atZero.action !== "review",
    guardrail_reason: atZero.action === "review" ? atZero.why : null,
    truth: { scenario: t.scenario, ideal: t.ideal, residual: t.residual, invoice_ids: t.allocations.map((a) => a.invoice_id), note: t.note },
    rules: { action: rules.action, outcome: rules.outcome },
    builtin: { action: builtin.action, outcome: builtin.outcome },
  };
});

const data = { generated: new Date().toISOString().slice(0, 10), customers: customers.length, invoices: invoices.length, rows, seed7: { builtin: seed7.builtin, rules: seed7.rules, agent: seed7.agent } };
const html = readFileSync("ui/template.html", "utf8").replace("/*__DATA__*/null", JSON.stringify(data));
writeFileSync("ui/index.html", html);
console.log(`ui/index.html written (${(html.length / 1024).toFixed(0)} KB, ${rows.length} payments)`);
