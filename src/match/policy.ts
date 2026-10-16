// The product decision layer. The matcher proposes; this decides what actually
// happens to the customer's books. Deliberately boring and auditable.
//
// Auto-apply requires ALL of:
//   1. The matcher is confident (>= threshold).
//   2. The allocation reconciles in code: invoices exist, belong to one customer,
//      and sum to the payment exactly, or exceed it by a plausible bank fee.
//   3. Two independent signals: identity (known payer OR a memo reference to one
//      of the invoices) plus amount (exact or fee-adjusted).
//   4. The residual is "none" or "processing_fee". Partials, short-pays and
//      overpayments always go to a human in v1.

import type { Action, Invoice, Payment, Proposal } from "../types.ts";
import { FEE_TOLERANCE, type Evidence } from "./candidates.ts";

export const DEFAULT_THRESHOLD = 0.9;

const cents = (n: number) => Math.round(n * 100);

export function decide(p: Payment, prop: Proposal, ev: Evidence, invoices: Invoice[], threshold = DEFAULT_THRESHOLD): Action {
  const act = (action: Action["action"], why: string): Action => ({ payment_id: p.id, action, proposal: prop, why });

  if (prop.decision === "not_invoice_payment") {
    return prop.confidence >= threshold ? act("leave_unmatched", "Confidently not an invoice payment.") : act("review", "Possibly not an invoice payment; low confidence.");
  }
  if (prop.decision === "unsure" || prop.allocations.length === 0) return act("review", "Matcher unsure.");
  if (prop.confidence < threshold) return act("review", `Confidence ${prop.confidence.toFixed(2)} below ${threshold}.`);

  const invs = prop.allocations.map((a) => invoices.find((i) => i.id === a.invoice_id));
  if (invs.some((i) => !i)) return act("review", "Proposal cites an unknown invoice.");
  const matched = invs as Invoice[];
  if (new Set(matched.map((i) => i.customer_id)).size > 1) return act("review", "Allocation spans customers.");

  const invoiceTotal = matched.reduce((s, i) => s + cents(i.amount), 0);
  const gap = invoiceTotal - cents(p.amount); // positive = paid less than owed
  if (prop.residual === "none" && gap !== 0) return act("review", "Amounts do not reconcile.");
  if (prop.residual === "processing_fee" && !(gap > 0 && gap <= FEE_TOLERANCE * 100)) return act("review", "Claimed fee is outside tolerance.");
  if (prop.residual !== "none" && prop.residual !== "processing_fee") return act("review", `Residual "${prop.residual}" needs a human.`);

  const customer = matched[0].customer_id;
  const knownPayer = ev.payers.some((m) => m.strength === "alias" && m.customer_id === customer);
  const memoRef = ev.referenced.some((r) => matched.some((m) => m.id === r.id));
  if (!knownPayer && !memoRef) return act("review", "No identity signal: payer unknown and memo cites none of these invoices.");

  const conflicting = ev.referenced.filter((r) => r.customer_id === customer && !matched.some((m) => m.id === r.id));
  if (conflicting.length) return act("review", `Memo cites ${conflicting.map((r) => r.number).join(", ")}, which is not in the allocation.`);

  if (matched.length > 1 && !memoRef) {
    const fits = ev.combos.filter((c) => cents(c.total) - cents(p.amount) === gap);
    if (fits.length > 1) return act("review", `${fits.length} invoice combinations fit this amount.`);
  }

  return act("auto_apply", prop.residual === "processing_fee" ? `Auto-applied; $${(gap / 100).toFixed(2)} written off as bank fee.` : "Auto-applied.");
}
