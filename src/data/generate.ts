// Generates a synthetic but realistic AR dataset: customers, open invoices,
// a bank feed of incoming payments, and the ground truth for each payment.
// Deterministic (seeded) so eval numbers are reproducible.
//
// Usage: [DATA_DIR=data] node src/data/generate.ts [seed]

import { mkdirSync, writeFileSync } from "node:fs";
import type { Customer, GroundTruth, Invoice, Payment, Rail, Scenario } from "../types.ts";

const seed = Number(process.argv[2] ?? 42);

function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const money = (n: number) => Math.round(n * 100) / 100;

// Fictional businesses across the segments the posting names:
// technology, professional services, real estate.
// [legal name, aliases seen on past payments]
const CUSTOMER_SEED: [string, string[]][] = [
  ["Northwind Robotics, Inc.", ["NORTHWIND ROBOTICS IN", "NWR HOLDINGS LLC"]],
  ["Halcyon Data Labs LLC", ["HALCYON DATA LABS"]],
  ["Brightpath Legal Group PC", ["BRIGHTPATH LEGAL GRP", "BILL.COM PAYABLES"]],
  ["Copperline Property Management", ["COPPERLINE PROP MGMT"]],
  ["Ferncliff Studio", ["FERNCLIFF STUDIO", "DANA OKAFOR"]],
  ["Juniper & Vale CPAs", ["JUNIPER AND VALE CPA"]],
  ["Ostara Health Technologies", ["OSTARA HEALTH TECH"]],
  ["Redwood Row Realty", ["REDWOOD ROW REALTY", "RRR ESCROW TRUST ACCT"]],
  ["Tidewater Logistics Co.", ["TIDEWATER LOGISTICS"]],
  ["Lumen Arc Software", ["LUMEN ARC SOFTWARE", "LUMENARC INC"]],
  ["Marrow & Finch Architects", ["MARROW FINCH ARCH"]],
  ["Peregrine Analytics", ["PEREGRINE ANALYTICS"]],
  ["Acme Analytics LLC", ["ACME ANALYTICS LLC"]],
  ["Acme Builders Supply", ["ACME BUILDERS SUPPLY"]],
  ["Saltmarsh Coffee Roasters", ["SALTMARSH COFFEE", "SQUARE INC PAYOUT"]],
  ["Quillon Recruiting Partners", ["QUILLON RECRUITING"]],
  ["Ironbark Capital Advisors", ["IRONBARK CAPITAL ADV"]],
  ["Glasswing Interactive", ["GLASSWING INTERACTIV", "GW MEDIA HOLDINGS"]],
  ["Starling Dental Partners", ["STARLING DENTAL"]],
  ["Kestrel Field Services", ["KESTREL FIELD SVCS"]],
  ["Meridian Yard Coworking", ["MERIDIAN YARD"]],
  ["Bluefin Biosciences", ["BLUEFIN BIOSCIENCES"]],
  ["Orchard Lane Homes", ["ORCHARD LANE HOMES", "PRIYA RAMAN"]],
  ["Vantage Point Consulting", ["VANTAGE POINT CONSUL"]],
  ["Cobalt Freight Systems", ["COBALT FREIGHT SYS"]],
  ["Heron Bay Hospitality", ["HERON BAY HOSPITALITY"]],
  ["Thistle & Pine Design", ["THISTLE PINE DESIGN"]],
  ["Summit Ridge Engineering", ["SUMMIT RIDGE ENGINEER"]],
  ["Wren Street Ventures", ["WREN STREET VENTURES"]],
  ["Polaris Payroll Partners", ["POLARIS PAYROLL"]],
];

const customers: Customer[] = CUSTOMER_SEED.map(([name, aliases], i) => ({
  id: `cus_${String(i + 1).padStart(3, "0")}`,
  name,
  aliases,
}));

// Amounts that recur across customers create genuine ambiguity, as retainers do in real life.
const COMMON_AMOUNTS = [2500, 5000, 7500, 10000, 1200];

let invoiceSeq = 1001;
const invoices: Invoice[] = [];
const isoDay = (offset: number) => {
  const d = new Date(Date.UTC(2026, 8, 1)); // Sep 1 2026
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
for (const c of customers) {
  const n = int(4, 7);
  for (let k = 0; k < n; k++) {
    const amount = rand() < 0.22 ? pick(COMMON_AMOUNTS) : money(int(400, 24000) + pick([0, 0, 0.5, 0.25, 0.99, 0.4]));
    const issued = int(0, 30);
    invoices.push({
      id: `inv_${invoiceSeq}`,
      number: `INV-${invoiceSeq}`,
      customer_id: c.id,
      amount,
      issued: isoDay(issued),
      due: isoDay(issued + pick([15, 30, 30, 45])),
      status: "open",
    });
    invoiceSeq++;
  }
}

const used = new Set<string>();
const customerOf = (inv: Invoice) => customers.find((c) => c.id === inv.customer_id)!;
const amountCount = (amt: number) => invoices.filter((i) => i.amount === amt).length;

// Pick an unused invoice satisfying a predicate.
function takeInvoice(pred: (i: Invoice) => boolean = () => true): Invoice {
  const pool = invoices.filter((i) => !used.has(i.id) && pred(i));
  if (!pool.length) throw new Error("invoice pool exhausted for predicate");
  const inv = pick(pool);
  used.add(inv.id);
  return inv;
}

const unique = (i: Invoice) => amountCount(i.amount) === 1;
const bankName = (c: Customer) => c.aliases[0];
const digits = (inv: Invoice) => inv.number.slice(4);

const payments: Payment[] = [];
const truth: GroundTruth[] = [];
let paySeq = 1;
let dayCursor = 30;

function addPayment(
  scenario: Scenario,
  p: { amount: number; rail: Rail; counterparty: string; memo: string },
  t: Omit<GroundTruth, "payment_id" | "scenario">,
) {
  const id = `pay_${String(paySeq++).padStart(3, "0")}`;
  dayCursor += rand() < 0.5 ? 0 : 1;
  payments.push({ id, date: isoDay(dayCursor), ...p, amount: money(p.amount) });
  truth.push({ payment_id: id, scenario, ...t });
}

// Scarce scenarios first, so their eligible invoices aren't consumed by easy ones.

// 7. Paid from a different entity: parent company, founder's personal account, AP platform, or processor payout.
const differentPayerCustomers = customers.filter((c) => c.aliases.length > 1);
for (let k = 0; k < 9; k++) {
  const c = differentPayerCustomers[k % differentPayerCustomers.length];
  const inv = takeInvoice((i) => i.customer_id === c.id);
  const alias = c.aliases[c.aliases.length - 1];
  const withRef = rand() < 0.6;
  addPayment(
    "different_payer",
    { amount: inv.amount, rail: pick(["ach", "card", "check"]), counterparty: alias, memo: withRef ? pick([inv.number, `ref ${digits(inv)}`]) : "" },
    { ideal: withRef || invoices.filter((j) => j.customer_id === c.id && j.amount === inv.amount).length === 1 ? "auto" : "review", allocations: [{ invoice_id: inv.id, amount: inv.amount }], residual: "none", note: `Paid by "${alias}", a payer previously seen paying for ${c.name}.` },
  );
}

// 8. Ambiguous: a common retainer amount, no reference, generic payer string.
for (let k = 0; k < 5; k++) {
  const amt = pick(COMMON_AMOUNTS.filter((a) => invoices.filter((i) => i.amount === a && !used.has(i.id)).length >= 2));
  const inv = takeInvoice((i) => i.amount === amt);
  addPayment(
    "ambiguous",
    { amount: amt, rail: "ach", counterparty: pick(["ORIG CO NAME:PAYMENTS", "ACH CREDIT", "ONLINE TRANSFER", "MOBILE DEPOSIT"]), memo: "" },
    { ideal: "review", allocations: [{ invoice_id: inv.id, amount: amt }], residual: "none", note: `$${amt} matches several open invoices across customers and nothing identifies the payer. Must not auto-apply.` },
  );
}

// 10. Reference points to one invoice, amount matches a different one at the same customer.
for (let k = 0; k < 4; k++) {
  const real = takeInvoice((i) => invoices.filter((j) => j.customer_id === i.customer_id && !used.has(j.id) && j.id !== i.id && Math.abs(j.amount - i.amount) > 50).length >= 1);
  const c = customerOf(real);
  const decoy = invoices.find((j) => j.customer_id === c.id && !used.has(j.id) && Math.abs(j.amount - real.amount) > 50)!;
  addPayment(
    "wrong_reference",
    { amount: real.amount, rail: "ach", counterparty: bankName(c), memo: decoy.number },
    { ideal: "review", allocations: [{ invoice_id: real.id, amount: real.amount }], residual: "none", note: `Memo cites ${decoy.number} but the amount exactly matches ${real.number}. Likely a customer typo, but a human should confirm.` },
  );
}

// 5. One payment, several invoices for the same customer.
for (let k = 0; k < 9; k++) {
  const first = takeInvoice((i) => invoices.filter((j) => j.customer_id === i.customer_id && !used.has(j.id) && j.id !== i.id).length >= 2);
  const c = customerOf(first);
  const others = invoices.filter((j) => j.customer_id === c.id && !used.has(j.id));
  const n = Math.min(others.length, pick([1, 2, 2, 3]));
  const group = [first, ...others.slice(0, n)];
  group.forEach((g) => used.add(g.id));
  const total = group.reduce((s, g) => s + g.amount, 0);
  const listed = rand() < 0.5;
  addPayment(
    "multi_invoice",
    { amount: total, rail: pick(["ach", "wire", "check"]), counterparty: bankName(c), memo: listed ? group.map((g) => g.number).join(", ") : pick(["", "SEPT INVOICES", "BATCH PAYMENT", `${group.length} INVOICES`]) },
    { ideal: "auto", allocations: group.map((g) => ({ invoice_id: g.id, amount: g.amount })), residual: "none", note: `Pays ${group.length} invoices in full${listed ? "; memo lists them" : "; memo does not list them, only the sum fits"}.` },
  );
}

// 4. Wire fee: international or intermediary-bank fee shaved off.
for (let k = 0; k < 8; k++) {
  const inv = takeInvoice((i) => i.amount > 3000);
  const c = customerOf(inv);
  const fee = pick([15, 20, 25, 30, 35, 45]);
  addPayment(
    "wire_fee",
    { amount: inv.amount - fee, rail: "wire", counterparty: bankName(c), memo: pick([inv.number, `/RFB/${inv.number}`, `INVOICE ${digits(inv)} ${c.name.toUpperCase().slice(0, 12)}`]) },
    { ideal: "auto", allocations: [{ invoice_id: inv.id, amount: money(inv.amount - fee) }], residual: "processing_fee", note: `Short by $${fee}, a typical wire fee. Apply and write off the fee.` },
  );
}

// 6. Partial payment.
for (let k = 0; k < 6; k++) {
  const inv = takeInvoice((i) => i.amount > 2000);
  const c = customerOf(inv);
  const frac = pick([0.5, 0.5, 0.25, 0.4]);
  const amt = money(inv.amount * frac);
  addPayment(
    "partial",
    { amount: amt, rail: "ach", counterparty: bankName(c), memo: pick([`${inv.number} partial`, `${inv.number} 1 of 2`, `deposit ${inv.number}`, inv.number]) },
    { ideal: "review", allocations: [{ invoice_id: inv.id, amount: amt }], residual: "partial", note: "Partial payment. Right invoice is clear, but the user should confirm the remaining balance stays open." },
  );
}

// 9. Overpayment.
for (let k = 0; k < 4; k++) {
  const inv = takeInvoice();
  const c = customerOf(inv);
  const extra = pick([100, 250, inv.amount * 0.1]);
  addPayment(
    "overpayment",
    { amount: inv.amount + extra, rail: pick(["ach", "check"]), counterparty: bankName(c), memo: inv.number },
    { ideal: "review", allocations: [{ invoice_id: inv.id, amount: inv.amount }], residual: "overpayment", note: "Pays the invoice plus extra. The user decides between a credit and a refund." },
  );
}

// 3. Garbled reference: typo'd, partial, or reformatted invoice number.
for (let k = 0; k < 10; k++) {
  const inv = takeInvoice();
  const c = customerOf(inv);
  const d = digits(inv);
  const memo = pick([
    `inv ${d}`,
    `INV${d}`,
    `invoice #${d.replace("0", "o")}`,
    `${c.name.split(" ")[0].toUpperCase()} INV ${d} SEP`,
    `RE: ${d} services`,
    `in v-${d}`,
  ]);
  addPayment(
    "garbled_memo",
    { amount: inv.amount, rail: pick(["ach", "wire"]), counterparty: bankName(c), memo },
    { ideal: "auto", allocations: [{ invoice_id: inv.id, amount: inv.amount }], residual: "none", note: "Reference is malformed but recoverable; amount matches exactly." },
  );
}

// 2. No memo, unique amount, recognizable payer.
for (let k = 0; k < 12; k++) {
  const inv = takeInvoice(unique);
  const c = customerOf(inv);
  addPayment(
    "no_memo",
    { amount: inv.amount, rail: "ach", counterparty: bankName(c), memo: pick(["", "PAYMENT", "AP PAYMENT", "VENDOR PMT"]) },
    { ideal: "auto", allocations: [{ invoice_id: inv.id, amount: inv.amount }], residual: "none", note: "No reference, but amount is unique among open invoices and the payer is known." },
  );
}

// 1. Clean: invoice number in memo, exact amount.
for (let k = 0; k < 22; k++) {
  const inv = takeInvoice();
  const c = customerOf(inv);
  addPayment(
    "clean",
    { amount: inv.amount, rail: pick(["ach", "ach", "wire", "card"]), counterparty: bankName(c), memo: pick([inv.number, `${inv.number} PAYMENT`, `Invoice ${inv.number}`, `PMT ${inv.number}`]) },
    { ideal: "auto", allocations: [{ invoice_id: inv.id, amount: inv.amount }], residual: "none", note: "Reference and amount both match." },
  );
}

// 11. Not an invoice payment at all.
const NOT_INVOICE: [string, string, number, Rail][] = [
  ["STRIPE TRANSFER", "STRIPE PAYOUT ST-8XK2", 3184.22, "ach"],
  ["AMAZON WEB SERVICES", "AWS REFUND CREDIT", 412.5, "ach"],
  ["INTEREST PAYMENT", "INTEREST PAID SEP", 38.91, "ach"],
  ["TRANSFER FROM CHECKING 4471", "INTERNAL TRANSFER", 10000, "ach"],
  ["IRS TREAS 310", "TAX REF", 1250, "ach"],
  ["GUSTO", "PAYROLL REVERSAL", 2500, "ach"],
];
for (const [cp, memo, amt, rail] of NOT_INVOICE) {
  addPayment(
    "not_invoice",
    { amount: amt, rail, counterparty: cp, memo },
    { ideal: "no_invoice", allocations: [], residual: "none", note: "Not a customer paying an invoice. Some amounts collide with open invoices on purpose." },
  );
}

// Shuffle the feed so scenarios are interleaved like a real day of deposits.
const order = payments.map((_, i) => i).sort(() => rand() - 0.5);
// Re-number and re-date after shuffling so neither leaks the scenario.
const dates = payments.map((x) => x.date).sort();
const feed = order.map((i, k) => ({ ...payments[i], id: `pay_${String(k + 1).padStart(3, "0")}`, date: dates[k] }));
const feedTruth = order.map((i, k) => ({ ...truth[i], payment_id: feed[k].id }));

const DIR = process.env.DATA_DIR ?? "data";
mkdirSync(DIR, { recursive: true });
writeFileSync(`${DIR}/customers.json`, JSON.stringify(customers, null, 2));
writeFileSync(`${DIR}/invoices.json`, JSON.stringify(invoices, null, 2));
writeFileSync(`${DIR}/payments.json`, JSON.stringify(feed, null, 2));
writeFileSync(`${DIR}/ground_truth.json`, JSON.stringify(feedTruth, null, 2));

const byScenario = feedTruth.reduce<Record<string, number>>((m, t) => ((m[t.scenario] = (m[t.scenario] ?? 0) + 1), m), {});
console.log(`seed=${seed} customers=${customers.length} open_invoices=${invoices.length} payments=${feed.length}`);
console.log(byScenario);
