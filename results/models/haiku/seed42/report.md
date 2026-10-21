# Eval results

99 incoming payments against 168 open invoices across 30 customers. Synthetic data from `data/`. Model: `claude-haiku-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 99 | 0 | 0 | 0 | 5.0 h |
| Built-in: virtual account + exact amount | 40% | 0 | 0 | 0 | 0 | 59 | 3.0 h |
| Rules baseline | 61% | 0 | 39 | 20 | 0 | 0 | 1.0 h |
| Agent + policy | 45% | 0 | 54 | 40 | 10 | 0 | 0.5 h |

- **Built-in** follows Mercury's API docs: a transfer to a customer's virtual account number is marked paid on an exact-amount match. Anything it doesn't match waits until someone finds it ("silently skipped").
- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 73 payments a careful human would apply without hesitation, rules handle 77% and the agent handles 56%.
- 55 of 99 payments were sent to a customer's virtual account number. That share is an assumption; real traffic decides how much built-in matching covers.

## By scenario

| Scenario | Count | To virtual account | Built-in | Rules | Agent |
|---|---|---|---|---|---|
| ambiguous | 5 | 0 | 0/5 auto | 0/5 auto | 0/5 auto, 3 review (shortlist) |
| no_memo | 12 | 7 | 7/12 auto | 12/12 auto | 3/12 auto, 9 review (good guess) |
| partial | 6 | 5 | 0/6 auto | 0/6 auto, 4 review (good guess) | 0/6 auto, 4 review (good guess), 2 review (shortlist) |
| different_payer | 9 | 6 | 6/9 auto | 9/9 auto | 6/9 auto, 3 review (good guess) |
| multi_invoice | 9 | 3 | 0/9 auto | 0/9 auto | 3/9 auto, 5 review (good guess), 1 review (shortlist) |
| garbled_memo | 10 | 7 | 7/10 auto | 10/10 auto | 8/10 auto, 2 review (good guess) |
| clean | 22 | 11 | 11/22 auto | 22/22 auto | 18/22 auto, 4 review (good guess) |
| not_invoice | 6 | 0 | 6/6 auto | 4/6 auto | 4/6 auto, 1 review (good guess) |
| wire_fee | 8 | 5 | 0/8 auto | 0/8 auto, 8 review (good guess) | 1/8 auto, 7 review (good guess) |
| overpayment | 4 | 4 | 0/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (good guess) |
| wrong_reference | 4 | 3 | 3/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (shortlist) |
| twin_amount | 4 | 4 | 0/4 auto | 3/4 auto | 2/4 auto, 1 review (good guess) |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 76% | 0 | 24 | 0.4 h | 84% / 0 |
| 0.7 | 76% | 0 | 24 | 0.4 h | 82% / 0 |
| 0.8 | 75% | 0 | 25 | 0.4 h | 78% / 0 |
| 0.85 | 69% | 0 | 31 | 0.4 h | 70% / 0 |
| 0.9 | 45% | 0 | 54 | 0.5 h | 46% / 0 |
| 0.95 | 24% | 0 | 75 | 0.6 h | 24% / 0 |
| 0.98 | 0% | 0 | 99 | 0.7 h | 0% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 2 | 100% |
| 0.70 - 0.89 | 35 | 100% |
| 0.90 - 0.94 | 22 | 100% |
| >= 0.95 | 24 | 100% |

## Agent errors and near misses

- **pay_009** (not_invoice, review_no_good_suggestion): expected no invoice, agent proposed unsure at 0.90. Agent: "This is a Stripe payout of $3,184.22, which is Stripe settling card payments it collected, often for many customers at once, so it can't be tied to one invoice. No open invoices, customers, invoice numbers, or matching amounts were found, so there's nothing to allocate it to. A person should check the Stripe payout report to see which charges make up this $3,184.22 and then match those charges to invoices." Policy: Matcher unsure.
- **pay_012** (ambiguous, review_no_good_suggestion): expected inv_1105, agent proposed unsure at 0.10. Agent: "The $7,500 ACH credit has no memo, no payer name, and was sent to the main account, so nothing identifies who paid. Four open invoices from four different customers are each exactly $7,500, and none of the customers' known payer names appear in the bank feed, so there is no basis to pick one. Someone needs to check the ACH originator details with the bank before applying it." Policy: Matcher unsure.
- **pay_029** (twin_amount, review_no_good_suggestion): expected inv_1168, agent proposed unsure at 0.40. Agent: "The payment is clearly from Northwind Robotics (cus_001), since it was sent to that customer's virtual account and the payer name matches. Two of that customer's open invoices are exactly $2,500 (INV-1168, due 2026-10-08, and INV-1006, due 2026-10-25), and the memo doesn't say which one it pays, so I can't pick one with confidence. INV-1168 is the older, overdue invoice, which a first-in-first-out rule would favor, but that is a guess and a reviewer should confirm before posting." Policy: Matcher unsure.
- **pay_077** (ambiguous, review_no_good_suggestion): expected inv_1066, agent proposed unsure at 0.20. Agent: "Three open invoices from three different customers are each exactly $5,000, and nothing in the payment identifies which one this is: the memo is empty, the originator "ORIG CO NAME:PAYMENTS" is a generic name that matches no known payer, and the payment went to the main account. INV-1048 (Tidewater, $5,024.25) is $24.25 more than the payment, which is not a typical processing-fee amount, so it is a weaker fit; it does not resolve the choice among the three exact matches." Policy: Matcher unsure.

## Cost and latency

99 agent calls, $0.07 total at list price ($0.001 per payment), average 5.5 s per call.
Average tokens per call: 2 input, 1,552 written to cache, 1,328 read from cache, 809 output (including thinking).
