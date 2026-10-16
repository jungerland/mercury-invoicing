# Payment Auto-Match: product memo

DRAFT. Claude wrote this from the eval results. Lines marked **[Jay: ...]** need your own judgment or experience before this goes anywhere.

## The problem

Sending an invoice is half of getting paid. The other half is figuring out which invoice a deposit belongs to. Bank memos are mangled or empty, customers pay from parent companies and personal accounts, wire fees shave off $25, and one ACH covers three invoices. Each of those is a few minutes of a founder's or bookkeeper's time. Until it's done, their receivables are wrong, which means reminders go to customers who already paid.

The goal is payments that match themselves to the right invoice without anyone lifting a finger. The constraint is that invoices are money: a wrong match is far worse than a slow one.

**[Jay: one sentence on why this problem matters to you, or where you've seen it.]**

## What I built

A working prototype (live demo, code, eval). Code gathers evidence, a model proposes a match with a confidence and a plain-language reason, and code decides whether money moves. I measured it against a rules engine with access to the same evidence, on two synthetic datasets of 95 payments each.

| | Hands-off | Wrong auto-applies | Human time per 95 payments |
|---|---|---|---|
| By hand | 0% | 0 | 4.8 h |
| Rules engine | 58–60% | 0 | 1.0–1.1 h |
| Agent + guardrails, 0.90 bar | 69–75% | 0 | ~0.2 h |
| Agent + guardrails, 0.80 bar | 79–80% | 0 | ~0.2 h |

Human time uses stated assumptions: 3 min to match by hand, 15 s to confirm a correct suggestion, 20 min to unwind a wrong match.

## Product decisions

1. **The model proposes, code disposes.** The model is good at judgment (is "RE: 1128 services" a reference? is NWR Holdings the parent of Northwind?). It is the wrong place for arithmetic or for the final say on moving money. Code reconciles every amount to the cent and enforces the rules below. This also makes every auto-apply explainable after the fact.
2. **Two independent signals before money moves.** That means identity (a known payer, or a memo reference to the invoice) plus amount (exact, or short by a plausible bank fee). An exact $5,000 from "MOBILE DEPOSIT" never auto-applies, however confident anyone is.
3. **Partials and overpayments go to a person in v1.** These aren't hard to match. The customer has a choice to make: keep the overpayment as a credit or refund it, and confirm what stays open. I measured what this costs: 3 to 5 points of hands-off at the 0.90 bar.
4. **The auto-apply bar is a product dial, not a model setting.** Launch at 0.90. The eval suggests 0.80 is safe (the agent was right on every proposal it rated 0.70 or above), but zero errors in 125 auto-applies only bounds the true rate below about 2.4%. Real traffic earns the right to lower it.
5. **"Can't tell, it's one of these three" is a good answer.** For truly ambiguous deposits, a shortlist with a reason ("check the deposit image") beats a guess. Rules engines either guess or give up.

## What I deprioritized, and why

- **Automatic payment reminders.** These have high value, but they're only safe once matching is trusted. A reminder sent for an invoice that was already paid costs more trust than it earns.
- **Partial-payment plans and installment tracking.** A real need, but it's a feature with its own UX, not a matching problem.
- **Learning from reviewer corrections.** This is the obvious next step. The review queue is the data source, so it has to exist first.
- **Payout-level reconciliation for Stripe or Square.** One payout often covers many customers. That needs processor data, not a better matcher.

**[Jay: confirm or reorder these. The application asks what you deprioritized, so this list is a direct answer.]**

## How I'd measure it

- **North star:** share of incoming invoice payments reconciled with no human touch.
- **Guardrail:** wrong auto-apply rate, measured by reversals and support contacts. Target under 0.1%, reviewed weekly.
- **Inputs:** review-queue size per customer per week, time from deposit to reconciled, and suggestion acceptance rate.
- **Business:** the posting's metrics (Invoicing active users, feature adoption, retention). Retention should be cut by whether a customer's receivables stay accurate without work.

## How I'd roll it out

1. **Shadow mode.** Run on real deposits and log proposals without acting. Score them against what customers actually do. This replaces my synthetic eval with a real one.
2. **Suggest only.** Show the match and the reason in the existing flow, with one-click apply. Track acceptance.
3. **Auto-apply for the clearest cohort.** Exact reference plus exact amount from a known payer, then wire fees, then batch payments. Every auto-apply gets one-click undo.
4. **Lower the bar** as reversal data allows.

## Open questions

- How much better is payer identity from ACH originator IDs than from names? Probably a lot, and that's a free signal.
- How should this interact with Mercury Books and the accounting integrations (QuickBooks, Xero, NetSuite), so a match made here doesn't fight one made there?
- What share of real invoice volume is processor payouts versus direct ACH and wire? That decides whether payout reconciliation moves up the list.

## Caveats

The data is synthetic and I wrote both it and the agent. I did no prompt tuning against it; the reported results are from the first full run. Real bank feeds will be messier, which is why step 1 of the rollout is shadow mode.

**[Jay: add one line from your own experience shipping something where money moved and mistakes were costly. The posting asks for exactly that.]**
