**PRODUCT MEMO**

# Grit Remover: an unapplied cash resolver agent

Mercury marks an invoice paid only when a transfer hits the customer's virtual account at the exact amount. I built an agent for the payments it leaves behind. On synthetic data it took the percentage of payments handled automatically from 31–40% to 70–78%, with zero wrong automatic matches, for a cost of under half a cent per payment.

## The problem

Sending an invoice is half of getting paid. The other half is knowing which invoice a deposit belongs to.

Mercury already solves the easier scenario. Each customer gets a virtual account number on their invoices, and a bank transfer to that number is marked paid when it matches an open invoice by exact amount. Mercury's API docs are clear about where that stops:

- "A short payment or an overpayment does not reconcile." Wire fees, partials and overpayments all go unmatched.
- Two open invoices for the same customer and amount "look identical when payment arrives."
- One transfer that pays several invoices doesn't match any single invoice amount.
- Invoice statuses are Unpaid, Processing, Paid and Cancelled. There is no partially paid status, so the invoice either stays Unpaid or gets marked Paid, and both are wrong.
- Matching covers transfers to the virtual account. Larger customers may pay to the real account number, and corporate payables teams tend to set up a vendor's bank details once and keep using them.

Each miss costs a founder or bookkeeper a few minutes of hunting. Until it's done, receivables are wrong and reminders may go to customers who already paid. To a small business owner, a payment that arrived but sits unmatched can feel like money they still don't have.

The goal is payments that match themselves to the right invoice without anyone lifting a finger. The constraint is that invoices are money: a wrong match is far worse than a slow one.

## What I built

A working prototype with an eval. Try the [interactive demo](https://claude.ai/artifact/W5w7goumjU1Hdasa35nqAR), or see the [code and full results](https://github.com/jungerland/mercury-invoicing).

Deterministic code gathers evidence, a model proposes a match with a confidence level and a plain-language reason, and the code decides whether a payment gets applied.

I measured the agent's performance against two other ways of matching payments:

- **Built-in matching:** virtual account number plus exact amount, as Mercury documents it.
- **Rules baseline:** deterministic code I built for comparison. It uses the same evidence as the agent but only applies exact matches, with no fee tolerance or multi-invoice combinations.

The rules baseline is there to show what the model adds. It sees the same evidence as the agent with no model involved, so the gap between the two is the model's contribution, not better evidence.

All three ran on the same three sets of 99 generated payments. I generated the third set after the agent was finished, so I couldn't have unintentionally adjusted the agent to fit those payments. The results held up on the third set too.

|                              | Handled automatically | Wrong automatic matches | Human time per 99 payments |
| ---------------------------- | --------------------- | ----------------------- | -------------------------- |
| By hand                      | 0%                    | 0                       | 5.0 h                      |
| Built-in matching            | 31–40%                | 0                       | 3.0–3.4 h                  |
| Rules baseline               | 59–61%                | 0                       | 1.0–1.3 h                  |
| Agent + guardrails, 0.90 bar | 70–78%                | 0                       | 0.2–0.3 h                  |
| Agent + guardrails, 0.80 bar | 78–80%                | 0                       | ~0.2 h                     |

Handled automatically means resolved correctly with no person involved: applied to the right invoice, or correctly left alone because it wasn't an invoice payment (a Stripe payout, say).

Human time uses stated assumptions: 3 min to match by hand, 15 s to confirm a correct suggestion, 20 min to unwind a wrong match.

About 55% of invoice payments in the data arrive on the customer's virtual account number. That percentage is my assumption. Mercury knows the real number, and that will inform how big this opportunity is. The fewer payments that use the virtual account, the more built-in matching misses.

Where the difference comes from:

- **Built-in matching never handles** the cases listed above, and nothing flags them, so 59 to 68 of every 99 deposits sit unmatched until someone notices.
- **The agent** applied 20 of 24 wire-fee payments, where both baselines applied none. Everything it didn't apply landed in a queue with a suggestion.
- **Cost:** about 1.4 cents and 5 seconds per payment at list price on the most capable model, or under half a cent with the routing noted in Decision 7 below.

## Product decisions

1. **Build on the virtual account number, don't replace it.** A deposit to a customer's virtual account identifies the payer for certain. The agent treats that as its identity signal and only has to work out which invoice and how much.
2. **The model suggests a match, code decides whether a payment is applied.** The model is good at judgment (is "RE: 1128 services" a reference? is NWR Holdings the parent of Northwind?). It is the wrong place for arithmetic or for the final say on marking an invoice paid. Code reconciles every amount to the cent and enforces the rules below. This also makes every automatic match explainable after the fact.
3. **Three conditions must hold before a payment is applied automatically.**
   - **Identity:** the virtual account, a known payer, or a memo reference to the invoice.
   - **Amount:** this is either exact, or is short by a plausible bank fee.
   - **No equally good alternative:** if another invoice, or another group of invoices, fits the payment just as well, it goes to human review unless the payment's memo field names the invoice.
1. **Partials and overpayments go to human review in v1.** These aren't hard to match. The customer has a choice to make: keep the overpayment as a credit or refund it, and confirm what stays open. I measured what this costs: about 2 to 6 of every 100 payments that the agent could otherwise have applied go to human review.
2. **The auto-apply bar is a product dial, not a model setting.** Launch at 0.90. The eval suggests 0.80 is safe: every proposal at 0.70 confidence or above was exactly right. But zero errors in 198 automatic matches only bounds the true rate below about 1.5%. Real traffic earns the right to lower it.
3. **"Can't tell, it's one of these" is a good answer.** For truly ambiguous deposits, a shortlist with a reason ("check the deposit image") beats a guess.
4. **Start cheap, and escalate only when unsure.** Free rules settle the obvious payments first. A small, cheap model (Haiku) takes the rest, and only what it isn't sure of goes to the most capable one (Opus). That cut model cost per payment from 1.4 cents to under half a cent, with no wrong matches and slightly more handled automatically. It held on a fourth test set I generated afterward. Where the expensive judgment gets spent is a product decision, and it's what keeps the feature cheap enough to offer every customer.

## What I deprioritized, and why

- **Smarter payment reminders.** Mercury already sends reminders on a fixed schedule. Tailoring them to each customer is valuable, but only once matching is trusted. Until then, a reminder might go to a customer who already paid, which makes the business look disorganized and erodes trust.
- **Payout-level reconciliation for Stripe or Square.** One payout often covers many customers. That needs processor data, not a better matcher.
- **Partial-payment plans and installment tracking.** A real need, but it's a feature with its own UX, not a matching problem. The partially paid status below is the first step.

## What I'd build next

1. **A partially paid invoice status.** It's a small change, it fixes how receivables look, and the matcher needs it to post a partial payment correctly.
2. **A check before an invoice is sent.** When startups bill larger companies, invoices often stall in the customer's payables team. The following published surveys support this, though not strongly. Customer cash flow is the most-cited cause of late payment, and no invoicing feature fixes that. But about a quarter of US suppliers cite invoices sent to the wrong person (26.7%) or with incorrect information (23.8%) (Atradius, 2017), and UK large businesses blame administrative errors for 36% of their late payments, against 24% overall, pointing to "no purchase order, no pay" policies (UK government, 2024).

   The check would catch a missing PO number, the wrong legal entity or the wrong recipient before the invoice goes out. It would learn each customer's rules from their replies ("please resubmit with PO number"), so every later invoice to them is right. It never moves money, which makes it a safe second AI feature.
3. **Learning from reviewer corrections.** Every payment a person confirms or fixes in the review queue is a labeled example. Feeding those back, starting with each customer's payer names and memo habits, should shrink the queue over time. The queue has to run first, since it is the data source.

## How I'd measure it

- **North star:** the percentage of incoming invoice payments applied to the right invoice automatically, with no human review.
- **Guardrail:** the wrong-match rate, meaning the percentage of automatic matches that turn out to be wrong. This is the number that must not go up as the north star does. In production, wrong matches only surface when someone notices: a customer undoes a match, or contacts support about one. Target: under 0.1%, or 1 in every 1,000 automatic matches, reviewed weekly. However, the eval can't prove the 0.1% target. Zero errors in 198 automatic matches only shows the rate is below about 1.5%, so shadow mode has to confirm it.
- **Inputs:** the numbers the team can move week to week that drive the north star.
  - **Review queue per customer:** how many payments each customer has to check by hand each week. It should shrink over time.
  - **Time to apply:** how long a payment waits between arriving and being applied to an invoice, whether by the agent or by human review.
  - **Suggestion acceptance:** how often a reviewer accepts the agent's suggested match without changing it. A high rate for a kind of payment, like one short by a bank wire fee, means it's ready to be matched automatically.
- **Business:** the metrics the Invoicing role is measured on: active users, feature adoption, and retention. I'd compare retention for two groups: customers whose payments get matched to invoices without manual work, and customers who still match payments by hand. If the first group stays longer, the feature is keeping customers.

## How I'd roll it out

1. **Shadow mode.** Run on real deposits and log proposals without acting. Score them against what customers actually do. This replaces my synthetic eval with a real one.
2. **Suggest only.** Show the match and the reason in the existing flow, with one-click apply. Track acceptance.
3. **Match automatically for the clearest cases first.** Start with payments short by a wire fee on the customer's virtual account, then payments to the main account whose memo field names the invoice and matches its amount exactly, then single transfers covering several invoices. Every automatic match gets one-click undo.
4. **Lower the bar** as reversal data allows.

## Open questions

- Mercury Books now uses AI to "categorize and reconcile" invoicing activity, which keeps the vendor's ledger in line with its bank account. It doesn't say whether Books also settles which invoice a payment paid and what's still owed. Where should invoice-level matching live, in Invoicing or in Books, so a match made in one never fights the other? The same goes for QuickBooks, Xero and NetSuite syncs.
- What percentage of invoice payments arrive on the real account number instead of the virtual one? That sets the size of the main-account half of this.
- What does Mercury do today with a virtual-account payment when two open invoices share the amount? The docs flag the problem but don't say.
- How much better is payer identity from ACH originator IDs than from names, for main-account payments? Probably a lot, and it's a free signal.

## Caveats

The data is synthetic. I designed both it and the agent and built them with Claude Code, so the test may share my blind spots. Mercury's built-in behavior is modeled from its public API docs, not tested in the product, and the app may offer manual tools the docs don't describe. I didn't adjust the model's instructions to fix mistakes I saw in the test results. The only change for this version tells the model which account number the money arrived on, and the reported results are from the first full run. Real bank feeds will be messier, which is why step 1 of the rollout is shadow mode.

## Sources

- [Mercury API docs: Invoicing](https://docs.mercury.com/docs/invoicing)
- [Mercury Books announcement, Sept 16, 2026](https://natlawreview.com/press-releases/mercury-launches-intelligent-accounting-mercury-books)
- [Atradius Payment Practices Barometer, Americas statistical appendix, 2017](https://atradius.us/dam/jcr:29d4ad52-eb2c-422c-9810-1c0dd89cab93/ppb17_the-americas_statistical-appendix_en_fin,4.pdf)
- [Atradius Payment Practices Barometer, US, 2026](https://group.atradius.com/dam/jcr:b4148500-b5c5-4f9c-bb8a-072a75afffad/payment-practices-barometer-us-2026-en.pdf)
- [UK Department for Business and Trade, Late payments research, 2024](https://assets.publishing.service.gov.uk/media/66eb01e7ba4b4b3f945016c8/late-payments-research-understanding-variations-in-payment-performance-and-practices-across-business-sectors-and-sizes.pdf)
