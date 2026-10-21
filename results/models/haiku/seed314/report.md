# Eval results

99 incoming payments against 173 open invoices across 30 customers. Synthetic data from `data/seed314/`. Model: `claude-haiku-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 99 | 0 | 0 | 0 | 5.0 h |
| Built-in: virtual account + exact amount | 32% | 0 | 0 | 0 | 0 | 67 | 3.4 h |
| Rules baseline | 60% | 0 | 40 | 22 | 0 | 0 | 1.0 h |
| Agent + policy | 41% | 0 | 58 | 47 | 8 | 0 | 0.5 h |

- **Built-in** follows Mercury's API docs: a transfer to a customer's virtual account number is marked paid on an exact-amount match. Anything it doesn't match waits until someone finds it ("silently skipped").
- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 73 payments a careful human would apply without hesitation, rules handle 77% and the agent handles 51%.
- 41 of 99 payments were sent to a customer's virtual account number. That share is an assumption; real traffic decides how much built-in matching covers.

## By scenario

| Scenario | Count | To virtual account | Built-in | Rules | Agent |
|---|---|---|---|---|---|
| multi_invoice | 9 | 3 | 0/9 auto | 0/9 auto | 2/9 auto, 6 review (good guess), 1 review (shortlist) |
| clean | 22 | 9 | 9/22 auto | 22/22 auto | 18/22 auto, 4 review (good guess) |
| garbled_memo | 10 | 5 | 5/10 auto | 10/10 auto | 7/10 auto, 3 review (good guess) |
| twin_amount | 4 | 4 | 0/4 auto | 3/4 auto | 0/4 auto, 3 review (good guess) |
| partial | 6 | 4 | 0/6 auto | 0/6 auto, 6 review (good guess) | 0/6 auto, 5 review (good guess), 1 review (shortlist) |
| wire_fee | 8 | 3 | 0/8 auto | 0/8 auto, 8 review (good guess) | 1/8 auto, 7 review (good guess) |
| overpayment | 4 | 1 | 0/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (good guess) |
| no_memo | 12 | 6 | 6/12 auto | 12/12 auto | 5/12 auto, 7 review (good guess) |
| wrong_reference | 4 | 2 | 2/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 1 review (good guess), 3 review (shortlist) |
| different_payer | 9 | 4 | 4/9 auto | 9/9 auto | 4/9 auto, 5 review (good guess) |
| ambiguous | 5 | 0 | 0/5 auto | 0/5 auto | 0/5 auto, 3 review (shortlist) |
| not_invoice | 6 | 0 | 6/6 auto | 3/6 auto | 4/6 auto, 2 review (good guess) |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 78% | 0 | 22 | 0.3 h | 85% / 1 |
| 0.7 | 78% | 0 | 22 | 0.3 h | 84% / 1 |
| 0.8 | 74% | 0 | 26 | 0.3 h | 77% / 0 |
| 0.85 | 68% | 0 | 32 | 0.4 h | 70% / 0 |
| 0.9 | 41% | 0 | 58 | 0.5 h | 41% / 0 |
| 0.95 | 17% | 0 | 82 | 0.6 h | 17% / 0 |
| 0.98 | 0% | 0 | 99 | 0.7 h | 0% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 1 | 100% |
| 0.70 - 0.89 | 43 | 98% |
| 0.90 - 0.94 | 24 | 100% |
| >= 0.95 | 17 | 100% |

## Agent errors and near misses

- **pay_034** (ambiguous, review_no_good_suggestion): expected inv_1094, agent proposed unsure at 0.10. Agent: "The payment is $10,000.00 by ACH from a generic originator ("ORIG CO NAME:PAYMENTS") with no memo, and that name doesn't match any customer's known payer names. Nine open invoices are exactly $10,000.00 across six customers, so the amount alone can't pick one." Policy: Matcher unsure.
- **pay_081** (ambiguous, review_no_good_suggestion): expected inv_1019, agent proposed unsure at 0.05. Agent: "The $10,000.00 ACH credit has no memo, no invoice numbers, and no payer name that matches any customer, so nothing identifies who sent it. Nine open invoices are exactly $10,000 across six customers, so the amount alone cannot pick one, and the payment date (2026-11-09) is also after today's date (2026-10-21), which needs checking before anything is posted." Policy: Matcher unsure.
- **pay_096** (twin_amount, review_no_good_suggestion): expected inv_1043, agent proposed unsure at 0.40. Agent: "The payer is clearly Redwood Row Realty (cus_008, sent to its virtual account, and the bank name matches a known payer), and the amount is exact. But cus_008 has two open $10,000 invoices, INV-1043 (due 2026-10-04) and INV-1173 (due 2026-10-17), with no memo to say which one this pays, so nothing separates them. The payment date (2026-11-17) is also after today's date (2026-10-21), which should be checked before anything is posted." Policy: Matcher unsure.

## Cost and latency

99 agent calls, $0.07 total at list price ($0.001 per payment), average 5.5 s per call.
Average tokens per call: 2 input, 1,572 written to cache, 1,355 read from cache, 842 output (including thinking).
