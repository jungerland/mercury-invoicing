// Baseline: what a decent rules engine does today. Uses the same evidence
// (including payer history), but only exact matches. No fees, no multi-invoice.

import type { Payment, Proposal } from "../types.ts";
import type { Evidence } from "./candidates.ts";

const same = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export function rulesMatch(p: Payment, ev: Evidence): Proposal {
  const base = { payment_id: p.id, residual: "none" as const, alternatives: [] as string[] };
  const strong = ev.payers.filter((m) => m.strength === "alias" || m.strength === "virtual_account").map((m) => m.customer_id);

  // R1: memo references an invoice and the amount matches it exactly.
  const ref = ev.referenced.find((i) => same(i.amount, p.amount));
  if (ref) return { ...base, decision: "match", allocations: [{ invoice_id: ref.id, amount: p.amount }], confidence: 1, reasoning: `R1: memo references ${ref.number}, amount matches.` };

  // R2: known payer with exactly one open invoice at this exact amount.
  if (strong.length === 1) {
    const hits = ev.exact_amount.filter((i) => i.customer_id === strong[0]);
    if (hits.length === 1) return { ...base, decision: "match", allocations: [{ invoice_id: hits[0].id, amount: p.amount }], confidence: 1, reasoning: "R2: known payer, unique amount for that customer." };
  }

  // Otherwise: send to a human with the best guess we have, or leave it alone.
  const guess = ev.referenced[0] ?? (ev.exact_amount.length === 1 ? ev.exact_amount[0] : undefined);
  if (guess) return { ...base, decision: "unsure", allocations: [{ invoice_id: guess.id, amount: p.amount }], confidence: 0.5, reasoning: "No rule fired; best guess shown." };
  if (ev.candidates.length === 0) return { ...base, decision: "not_invoice_payment", allocations: [], confidence: 1, reasoning: "No candidate invoices." };
  return { ...base, decision: "unsure", allocations: [], confidence: 0, reasoning: "No rule fired." };
}
