# Eval results

99 incoming payments against 165 open invoices across 30 customers. Synthetic data from `data/seed7/`. Model: `claude-haiku-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 99 | 0 | 0 | 0 | 5.0 h |
| Built-in: virtual account + exact amount | 34% | 0 | 0 | 0 | 0 | 65 | 3.3 h |
| Rules baseline | 60% | 0 | 40 | 20 | 0 | 0 | 1.1 h |
| Agent + policy | 43% | 0 | 56 | 45 | 9 | 0 | 0.4 h |

- **Built-in** follows Mercury's API docs: a transfer to a customer's virtual account number is marked paid on an exact-amount match. Anything it doesn't match waits until someone finds it ("silently skipped").
- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 73 payments a careful human would apply without hesitation, rules handle 77% and the agent handles 53%.
- 52 of 99 payments were sent to a customer's virtual account number. That share is an assumption; real traffic decides how much built-in matching covers.

## By scenario

| Scenario | Count | To virtual account | Built-in | Rules | Agent |
|---|---|---|---|---|---|
| clean | 22 | 10 | 9/22 auto | 22/22 auto | 15/22 auto, 7 review (good guess) |
| not_invoice | 6 | 0 | 6/6 auto | 3/6 auto | 4/6 auto, 2 review (good guess) |
| no_memo | 12 | 7 | 7/12 auto | 12/12 auto | 3/12 auto, 9 review (good guess) |
| garbled_memo | 10 | 4 | 4/10 auto | 10/10 auto | 8/10 auto, 2 review (good guess) |
| different_payer | 9 | 5 | 5/9 auto | 9/9 auto | 6/9 auto, 3 review (good guess) |
| wire_fee | 8 | 4 | 0/8 auto | 0/8 auto, 8 review (good guess) | 1/8 auto, 7 review (good guess) |
| ambiguous | 5 | 0 | 0/5 auto | 0/5 auto | 0/5 auto, 3 review (shortlist) |
| twin_amount | 4 | 4 | 0/4 auto | 3/4 auto | 2/4 auto, 2 review (good guess) |
| wrong_reference | 4 | 3 | 3/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (shortlist) |
| partial | 6 | 6 | 0/6 auto | 0/6 auto, 4 review (good guess) | 0/6 auto, 6 review (good guess) |
| overpayment | 4 | 3 | 0/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 2 review (good guess), 2 review (shortlist) |
| multi_invoice | 9 | 6 | 0/9 auto | 0/9 auto | 4/9 auto, 5 review (good guess) |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 79% | 0 | 21 | 0.3 h | 86% / 1 |
| 0.7 | 79% | 0 | 21 | 0.3 h | 85% / 0 |
| 0.8 | 79% | 0 | 21 | 0.3 h | 83% / 0 |
| 0.85 | 70% | 0 | 30 | 0.3 h | 72% / 0 |
| 0.9 | 43% | 0 | 56 | 0.4 h | 43% / 0 |
| 0.95 | 14% | 0 | 85 | 0.6 h | 14% / 0 |
| 0.98 | 0% | 0 | 99 | 0.6 h | 0% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 2 | 50% |
| 0.70 - 0.89 | 41 | 100% |
| 0.90 - 0.94 | 29 | 100% |
| >= 0.95 | 14 | 100% |

## Agent errors and near misses

- **pay_022** (ambiguous, review_no_good_suggestion): expected inv_1096, agent proposed unsure at 0.10. Agent: "The $7,500.00 ACH came from "ONLINE TRANSFER" with an empty memo and no payer-name match, so nothing identifies who sent it. Eleven open invoices across nine customers are exactly $7,500.00, so the amount alone cannot pick one." Policy: Matcher unsure.
- **pay_028** (ambiguous, review_no_good_suggestion): expected inv_1135, agent proposed unsure at 0.05. Agent: "The $7,500 ACH has no invoice number in the memo, the sender is only "ONLINE TRANSFER," and no payer name matches any customer's known payment sources. Eleven open invoices are exactly $7,500, so the amount alone cannot identify which one, and a wrong guess would post money to the wrong customer." Policy: Matcher unsure.

## Cost and latency

99 agent calls, $0.07 total at list price ($0.001 per payment), average 5.5 s per call.
Average tokens per call: 2 input, 1,521 written to cache, 1,355 read from cache, 802 output (including thinking).
