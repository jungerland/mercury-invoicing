// The agent: reads the payment plus deterministic evidence and proposes a match
// with a confidence and a one-line explanation a business owner can read.

import { z } from "zod";
import { structured, type Usage } from "../llm.ts";
import type { Customer, Invoice, Payment, Proposal } from "../types.ts";
import type { Evidence } from "./candidates.ts";

export const ProposalSchema = z.object({
  decision: z.enum(["match", "not_invoice_payment", "unsure"]),
  allocations: z.array(z.object({ invoice_id: z.string(), amount: z.number() })),
  residual: z.enum(["none", "processing_fee", "short_pay", "partial", "overpayment"]),
  confidence: z.number(),
  reasoning: z.string(),
  alternatives: z.array(z.string()),
});

export const SYSTEM = `You reconcile incoming bank payments against a small business's open invoices.

For each payment you get the bank-feed record (including which account number it was sent to), candidate open invoices, the customers they belong to (with names we've previously seen those customers pay from), and evidence computed by code: invoice numbers recovered from the memo, payer-name matches, exact-amount matches, and same-customer invoice combinations that sum to the payment. Trust the computed sums; don't redo arithmetic.

Propose what this payment is:
- "match": it pays one or more invoices. Give each allocation (invoice_id and the amount applied). Allocations should add up to the payment amount.
- "not_invoice_payment": it isn't a customer paying an invoice (refunds, payouts, interest, internal transfers, tax refunds, payroll reversals), even if the amount happens to equal an invoice.
- "unsure": you can't tell which invoice(s) with reasonable confidence.

residual describes any gap between what was owed and what was paid:
- "none": paid exactly.
- "processing_fee": a small shortfall consistent with wire or intermediary bank fees (a round amount, typically $10-$50).
- "partial": a deliberate partial or installment payment; the rest stays open.
- "short_pay": paid less for an unclear reason.
- "overpayment": paid more than the invoice(s).

confidence is your probability (0 to 1) that the allocation is exactly right. Be calibrated: a wrong match puts money on the wrong customer's books and is far more costly than asking a human. Lower your confidence when signals conflict (for example, the memo cites one invoice but the amount fits another), when the payer is unrecognized and nothing else identifies them, or when several invoices fit equally well.

reasoning: one or two plain sentences a business owner would understand, naming the deciding evidence.
alternatives: other invoice ids a reviewer should look at, if any.`;

const fmtInv = (i: Invoice) => `${i.id} | ${i.number} | ${i.customer_id} | $${i.amount.toFixed(2)} | due ${i.due}`;

export function buildPrompt(p: Payment, ev: Evidence, customers: Customer[]): string {
  const custIds = new Set([...ev.candidates.map((i) => i.customer_id), ...ev.payers.map((m) => m.customer_id)]);
  const custs = customers.filter((c) => custIds.has(c.id));
  return [
    `PAYMENT`,
    `id: ${p.id}`,
    `date: ${p.date}`,
    `amount: $${p.amount.toFixed(2)}`,
    `rail: ${p.rail}`,
    `counterparty (bank feed): ${p.counterparty}`,
    `memo: ${p.memo ? JSON.stringify(p.memo) : "(empty)"}`,
    `sent to: ${p.virtual_account ? `the virtual account number assigned only to ${p.virtual_account}, so the payer is that customer` : "the business's main account number (does not identify the payer)"}`,
    ``,
    `CUSTOMERS`,
    ...(custs.length ? custs.map((c) => `${c.id} | ${c.name} | previously paid from: ${c.aliases.join("; ")}`) : ["(none)"]),
    ``,
    `CANDIDATE OPEN INVOICES (id | number | customer | amount | due)`,
    ...(ev.candidates.length ? ev.candidates.map(fmtInv) : ["(none)"]),
    ``,
    `EVIDENCE`,
    `invoice numbers recovered from memo: ${ev.referenced.map((i) => i.number).join(", ") || "none"}`,
    `payer matches: ${ev.payers.map((m) => `${m.customer_id} (${m.strength === "virtual_account" ? "paid to this customer's virtual account" : m.strength === "alias" ? "exact match to a known payer name" : "shares a word with the customer name"})`).join(", ") || "none"}`,
    `open invoices at exactly this amount: ${ev.exact_amount.map((i) => `${i.number} (${i.customer_id})`).join(", ") || "none"}`,
    `invoices exceeding the payment by $50 or less: ${ev.near_amount.map((i) => `${i.number} (+$${(i.amount - p.amount).toFixed(2)})`).join(", ") || "none"}`,
    `same-customer invoice combinations that fit: ${ev.combos.map((c) => `[${c.invoice_ids.join(" + ")}] = $${c.total.toFixed(2)}${c.shortfall ? ` (short $${c.shortfall.toFixed(2)})` : ""}`).join("; ") || "none"}`,
  ].join("\n");
}

export async function agentMatch(p: Payment, ev: Evidence, customers: Customer[]): Promise<{ proposal: Proposal; costUsd: number | null; usage: Usage }> {
  const { data, costUsd, usage } = await structured(SYSTEM, buildPrompt(p, ev, customers), ProposalSchema);
  return { proposal: { payment_id: p.id, ...data }, costUsd, usage };
}
