// Deterministic evidence gathering, shared by the rules baseline and the agent.
// Everything numeric happens here, in code: the model never does arithmetic.

import type { Customer, Invoice, Payment } from "../types.ts";

export const FEE_TOLERANCE = 50; // max shortfall we'll treat as a bank/wire fee

export type PayerMatch = { customer_id: string; strength: "virtual_account" | "alias" | "name_token" };

export type Combo = { invoice_ids: string[]; total: number; shortfall: number };

export type Evidence = {
  referenced: Invoice[]; // invoices whose number appears (possibly garbled) in the memo
  payers: PayerMatch[];
  exact_amount: Invoice[]; // open invoices whose amount equals the payment exactly
  near_amount: Invoice[]; // invoice amount exceeds the payment by <= FEE_TOLERANCE
  combos: Combo[]; // same-customer sets of 2-4 invoices summing to the payment (or within fee tolerance)
  candidates: Invoice[]; // union of the above, capped, for the agent's context
};

const STOP = new Set(["INC", "LLC", "CO", "PC", "THE", "AND", "&", "GROUP", "GRP", "PARTNERS", "SERVICES", "SVCS", "SYSTEMS", "SYS"]);
const tokens = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9& ]/g, " ").split(/\s+/).filter((t) => t.length > 2 && !STOP.has(t));

const cents = (n: number) => Math.round(n * 100);

// Pull 4-digit invoice references out of a memo, forgiving common mangling:
// "INV1042", "in v-1042", "#1o42", "RE: 1042 services".
export function referencedNumbers(memo: string): string[] {
  const cleaned = memo.replace(/(?<=\d)[oO]|[oO](?=\d)/g, "0").replace(/(?<=\d)[ -](?=\d)/g, "");
  return [...cleaned.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((m) => m[1]);
}

export function payerMatches(counterparty: string, customers: Customer[]): PayerMatch[] {
  const cp = counterparty.toUpperCase().trim();
  const out: PayerMatch[] = [];
  for (const c of customers) {
    if (c.aliases.some((a) => a.toUpperCase() === cp)) {
      out.push({ customer_id: c.id, strength: "alias" });
      continue;
    }
    const cpTokens = new Set(tokens(cp));
    if (tokens(c.name).some((t) => cpTokens.has(t))) out.push({ customer_id: c.id, strength: "name_token" });
  }
  return out;
}

function subsetsSumming(invs: Invoice[], target: number): Combo[] {
  const out: Combo[] = [];
  const t = cents(target);
  const n = Math.min(invs.length, 12);
  for (let mask = 1; mask < 1 << n; mask++) {
    const bits = mask.toString(2).split("1").length - 1;
    if (bits < 2 || bits > 4) continue;
    let total = 0;
    const ids: string[] = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) (total += cents(invs[i].amount)), ids.push(invs[i].id);
    const short = total - t;
    if (short >= 0 && short <= FEE_TOLERANCE * 100) out.push({ invoice_ids: ids, total: total / 100, shortfall: short / 100 });
  }
  return out;
}

export function gatherEvidence(p: Payment, customers: Customer[], invoices: Invoice[]): Evidence {
  const refs = new Set(referencedNumbers(p.memo));
  const referenced = invoices.filter((i) => refs.has(i.number.slice(4)));
  // A deposit to a customer's virtual account number identifies that customer for certain.
  const byName = payerMatches(p.counterparty, customers);
  const payers: PayerMatch[] = p.virtual_account
    ? [{ customer_id: p.virtual_account, strength: "virtual_account" }, ...byName.filter((m) => m.customer_id !== p.virtual_account)]
    : byName;
  const amt = cents(p.amount);
  const exact_amount = invoices.filter((i) => cents(i.amount) === amt);
  const near_amount = invoices.filter((i) => {
    const d = cents(i.amount) - amt;
    return d > 0 && d <= FEE_TOLERANCE * 100;
  });
  const combos = payers.flatMap((m) => subsetsSumming(invoices.filter((i) => i.customer_id === m.customer_id), p.amount));

  const seen = new Map<string, Invoice>();
  const add = (i: Invoice) => seen.size < 25 && seen.set(i.id, i);
  referenced.forEach(add);
  exact_amount.forEach(add);
  near_amount.forEach(add);
  for (const c of combos) c.invoice_ids.forEach((id) => add(invoices.find((i) => i.id === id)!));
  for (const m of payers) invoices.filter((i) => i.customer_id === m.customer_id).forEach(add);
  // Referenced invoices' customers too: the memo can identify the payer when the bank name can't.
  for (const r of referenced) invoices.filter((i) => i.customer_id === r.customer_id).forEach(add);

  return { referenced, payers, exact_amount, near_amount, combos, candidates: [...seen.values()] };
}
