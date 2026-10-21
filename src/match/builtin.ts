// Baseline: virtual-account matching as Mercury's API docs describe it today. A bank
// transfer to a customer's virtual account number is marked paid when it matches an
// open invoice for that customer by exact amount. Short payments and overpayments
// "do not reconcile," and the docs don't cover main-account payments, so everything
// else is left for a person to find. Two open invoices at the same amount "look
// identical"; the docs don't say what happens, so this treats them as unmatched.

import type { Invoice, Payment, Proposal } from "../types.ts";

const same = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export function builtinMatch(p: Payment, invoices: Invoice[]): Proposal {
  const base = { payment_id: p.id, residual: "none" as const, alternatives: [] as string[] };
  if (p.virtual_account) {
    const hits = invoices.filter((i) => i.customer_id === p.virtual_account && same(i.amount, p.amount));
    if (hits.length === 1) return { ...base, decision: "match", allocations: [{ invoice_id: hits[0].id, amount: p.amount }], confidence: 1, reasoning: "Virtual account, exact amount." };
  }
  // Not matched automatically. Nothing flags it, so it waits until someone notices.
  return { ...base, decision: "not_invoice_payment", allocations: [], confidence: 1, reasoning: "Not matched automatically." };
}
