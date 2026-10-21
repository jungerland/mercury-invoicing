# Payment Auto-Match: product memo

DRAFT. Claude wrote this from the eval results and public sources. Lines marked **[Jay: ...]** need your own judgment or experience before this goes anywhere.

## The problem

Sending an invoice is half of getting paid. The other half is knowing which invoice a deposit belongs to.

Mercury already solves the easy version. Each customer gets a virtual account number on their invoices, and a bank transfer to that number is marked paid when it matches an open invoice by exact amount. Mercury's API docs are clear about where that stops:

- "A short payment or an overpayment does not reconcile." Wire fees, partials and overpayments all fall out.
- Two open invoices for the same customer and amount "look identical when payment arrives."
- One transfer that pays several invoices doesn't match any single invoice amount.
- Invoice statuses are Unpaid, Processing, Paid and Cancelled. There is no partially paid.
- Matching covers transfers to the virtual account. Larger customers often pay to the real account number, and corporate payables teams tend to set up a vendor's bank details once and keep using them.

Each miss costs a founder or bookkeeper a few minutes of hunting. Until it's done, receivables are wrong, which means reminders go to customers who already paid.

The goal is payments that match themselves to the right invoice without anyone lifting a finger. The constraint is that invoices are money: a wrong match is far worse than a slow one.

Small business owners live and die by cash flow, and a payment that arrived but sits unmatched feels to them like money they still don't have.

## What I built

A working prototype (live demo, code, eval). Code gathers evidence, a model proposes a match with a confidence and a plain-language reason, and code decides whether money moves. I measured it against two baselines on three synthetic datasets of 99 payments each. The third was generated after the agent was finished, to check it wasn't tuned to the first two:

- **Built-in matching:** virtual account number plus exact amount, as Mercury documents it.
- **Rules baseline:** one I built for comparison. It uses the same evidence as the agent but only takes exact matches.

| | Hands-off | Wrong auto-applies | Human time per 99 payments |
|---|---|---|---|
| By hand | 0% | 0 | 5.0 h |
| Built-in matching | 31–40% | 0 | 3.0–3.4 h |
| Rules baseline | 59–61% | 0 | 1.0–1.3 h |
| Agent + guardrails, 0.90 bar | 70–78% | 0 | 0.2–0.3 h |
| Agent + guardrails, 0.80 bar | 78–80% | 0 | ~0.2 h |

Human time uses stated assumptions: 3 min to match by hand, 15 s to confirm a correct suggestion, 20 min to unwind a wrong match.

About 55% of invoice payments in the data arrive on the customer's virtual account number. That share is my assumption. Mercury knows the real number, and it decides how big this opportunity is.

Where the difference comes from:

- **Built-in matching never handles** a wire fee, partial, overpayment, batch payment or same-amount pair, or anything sent to the main account number. Nothing flags those, so 59 to 68 of every 99 deposits sit unmatched until someone notices.
- **The agent** applied 20 of 24 wire-fee payments, where both baselines applied none. Everything it didn't apply landed in a queue with a suggestion.
- **Cost:** about 1.4 cents and 5 seconds per payment at list price on the most capable model, or under half a cent with the routing in decision 7.

## Product decisions

1. **Build on the virtual account number, don't replace it.** A deposit to a customer's virtual account identifies the payer for certain. The agent treats that as its identity signal and only has to work out which invoice and how much.
2. **The model suggests a match, code decides whether money moves.** The model is good at judgment (is "RE: 1128 services" a reference? is NWR Holdings the parent of Northwind?). It is the wrong place for arithmetic or for the final say on moving money. Code reconciles every amount to the cent and enforces the rules below. This also makes every auto-apply explainable after the fact.
3. **Two independent signals before money moves, and nothing else fits as well.**
   - **Identity:** the virtual account, a known payer, or a memo reference to the invoice.
   - **Amount:** exact, or short by a plausible bank fee.
   - **No equally good alternative:** a second open invoice at the same amount, or a second combination of invoices that adds up to the payment, sends it to a person unless the memo says which.
4. **Partials and overpayments go to a person in v1.** These aren't hard to match. The customer has a choice to make: keep the overpayment as a credit or refund it, and confirm what stays open. I measured what this costs: 2 to 6 points of hands-off at the 0.90 bar.
5. **The auto-apply bar is a product dial, not a model setting.** Launch at 0.90. The eval suggests 0.80 is safe: every proposal at 0.70 confidence or above was exactly right. But zero errors in 198 auto-applies only bounds the true rate below about 1.5%. Real traffic earns the right to lower it.
6. **"Can't tell, it's one of these" is a good answer.** For truly ambiguous deposits, a shortlist with a reason ("check the deposit image") beats a guess.
7. **Start cheap, and escalate only when unsure.** Free rules settle the obvious payments first. A small, cheap model (Haiku) takes the rest, and only what it isn't sure of goes to the most capable one (Opus). That cut model cost per payment from 1.4 cents to under half a cent, with no wrong matches and slightly more hands-off. It held on a fourth test set I generated afterward. Where the expensive judgment gets spent is a product decision, and it's what keeps the feature cheap enough to offer every customer.

## What I deprioritized, and why

- **Smarter payment reminders.** Mercury already sends reminders on a fixed schedule. Tailoring them to each customer is valuable, but only once matching is trusted. A reminder for an invoice that was already paid costs more trust than it earns.
- **Partial-payment plans and installment tracking.** A real need, but it's a feature with its own UX, not a matching problem. The partially paid status below is the first step.
- **Learning from reviewer corrections.** This is the obvious next step for the matcher. The review queue is the data source, so it has to exist first.
- **Payout-level reconciliation for Stripe or Square.** One payout often covers many customers. That needs processor data, not a better matcher.

**[Jay: confirm or reorder these. The application asks what you deprioritized, so this list is a direct answer.]**

## What I'd build next

1. **A partially paid invoice status.** It's a small change, it fixes how receivables look, and the matcher needs it to post a partial payment correctly.
2. **A check before an invoice is sent.** When startups bill larger companies, invoices often stall in the customer's payables team. The public data is directional, not decisive:
   - Customer cash flow is the most-cited cause of late payment in every independent survey. No invoicing feature fixes that.
   - In Atradius's 2017 survey, about a quarter of US suppliers cited invoices sent to the wrong person (26.7%) or with incorrect information (23.8%).
   - In the UK government's 2024 study, large businesses blamed administrative errors for 36% of the late payments they received, against 24% overall. The authors point to "no purchase order, no pay" policies.

   The check would catch a missing PO number, the wrong legal entity or the wrong recipient before the invoice goes out. It would learn each customer's rules from their replies ("please resubmit with PO number"), so every later invoice to them is right. It never moves money, which makes it a safe second AI feature.

## How I'd measure it

- **North star:** share of incoming invoice payments reconciled with no human touch.
- **Guardrail:** wrong auto-apply rate, measured by reversals and support contacts. Target under 0.1%, reviewed weekly.
- **Inputs:** review-queue size per customer per week, time from deposit to reconciled, and suggestion acceptance rate.
- **Business:** the posting's metrics (Invoicing active users, feature adoption, retention). Retention should be cut by whether a customer's receivables stay accurate without work.

## How I'd roll it out

1. **Shadow mode.** Run on real deposits and log proposals without acting. Score them against what customers actually do. This replaces my synthetic eval with a real one.
2. **Suggest only.** Show the match and the reason in the existing flow, with one-click apply. Track acceptance.
3. **Auto-apply for the clearest cohort.** Wire fees on the virtual account first, then exact reference plus exact amount on the main account, then batch payments. Every auto-apply gets one-click undo.
4. **Lower the bar** as reversal data allows.

## Open questions

- What share of invoice payments arrive on the real account number instead of the virtual one? That sets the size of the main-account half of this.
- Mercury Books now uses AI to "categorize and reconcile" invoicing activity, which keeps the vendor's ledger in line with its bank account. It doesn't say whether Books also settles which invoice a payment paid and what's still owed. Where should invoice-level matching live, in Invoicing or in Books, so a match made in one never fights the other? The same goes for QuickBooks, Xero and NetSuite syncs.
- What does Mercury do today with a virtual-account payment when two open invoices share the amount? The docs flag the problem but don't say.
- How much better is payer identity from ACH originator IDs than from names, for main-account payments? Probably a lot, and it's a free signal.
- What share of real invoice volume is processor payouts versus direct ACH and wire? That decides whether payout reconciliation moves up the list.

## Caveats

The data is synthetic and I wrote both it and the agent. Mercury's built-in behavior is modeled from its public API docs, not tested in the product, and the app may offer manual tools the docs don't describe. I did no prompt tuning against the data. The only prompt change for this version tells the model which account number the money arrived on, and the reported results are from the first full run. Real bank feeds will be messier, which is why step 1 of the rollout is shadow mode.

**[Jay: add one line from your own experience shipping something where money moved and mistakes were costly. The posting asks for exactly that.]**

## Sources

- [Mercury API docs: Invoicing](https://docs.mercury.com/docs/invoicing)
- [Mercury Books announcement, Sept 16, 2026](https://natlawreview.com/press-releases/mercury-launches-intelligent-accounting-mercury-books)
- [Atradius Payment Practices Barometer, Americas statistical appendix, 2017](https://atradius.us/dam/jcr:29d4ad52-eb2c-422c-9810-1c0dd89cab93/ppb17_the-americas_statistical-appendix_en_fin,4.pdf)
- [Atradius Payment Practices Barometer, US, 2026](https://group.atradius.com/dam/jcr:b4148500-b5c5-4f9c-bb8a-072a75afffad/payment-practices-barometer-us-2026-en.pdf)
- [UK Department for Business and Trade, Late payments research, 2024](https://assets.publishing.service.gov.uk/media/66eb01e7ba4b4b3f945016c8/late-payments-research-understanding-variations-in-payment-performance-and-practices-across-business-sectors-and-sizes.pdf)
