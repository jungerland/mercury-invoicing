# Eval results

99 incoming payments against 165 open invoices across 30 customers. Synthetic data from `data/seed7/`. Model: `claude-sonnet-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 99 | 0 | 0 | 0 | 5.0 h |
| Built-in: virtual account + exact amount | 34% | 0 | 0 | 0 | 0 | 65 | 3.3 h |
| Rules baseline | 60% | 0 | 40 | 20 | 0 | 0 | 1.1 h |
| Agent + policy | 76% | 0 | 24 | 19 | 5 | 0 | 0.2 h |

- **Built-in** follows Mercury's API docs: a transfer to a customer's virtual account number is marked paid on an exact-amount match. Anything it doesn't match waits until someone finds it ("silently skipped").
- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 73 payments a careful human would apply without hesitation, rules handle 77% and the agent handles 95%.
- 52 of 99 payments were sent to a customer's virtual account number. That share is an assumption; real traffic decides how much built-in matching covers.

## By scenario

| Scenario | Count | To virtual account | Built-in | Rules | Agent |
|---|---|---|---|---|---|
| clean | 22 | 10 | 9/22 auto | 22/22 auto | 22/22 auto |
| not_invoice | 6 | 0 | 6/6 auto | 3/6 auto | 6/6 auto |
| no_memo | 12 | 7 | 7/12 auto | 12/12 auto | 12/12 auto |
| garbled_memo | 10 | 4 | 4/10 auto | 10/10 auto | 10/10 auto |
| different_payer | 9 | 5 | 5/9 auto | 9/9 auto | 9/9 auto |
| wire_fee | 8 | 4 | 0/8 auto | 0/8 auto, 8 review (good guess) | 5/8 auto, 3 review (good guess) |
| ambiguous | 5 | 0 | 0/5 auto | 0/5 auto | 0/5 auto, 5 review (shortlist) |
| twin_amount | 4 | 4 | 0/4 auto | 3/4 auto | 3/4 auto, 1 review (good guess) |
| wrong_reference | 4 | 3 | 3/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (good guess) |
| partial | 6 | 6 | 0/6 auto | 0/6 auto, 4 review (good guess) | 0/6 auto, 6 review (good guess) |
| overpayment | 4 | 3 | 0/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (good guess) |
| multi_invoice | 9 | 6 | 0/9 auto | 0/9 auto | 8/9 auto, 1 review (good guess) |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 80% | 0 | 20 | 0.1 h | 95% / 0 |
| 0.7 | 80% | 0 | 20 | 0.1 h | 91% / 0 |
| 0.8 | 80% | 0 | 20 | 0.1 h | 88% / 0 |
| 0.85 | 79% | 0 | 21 | 0.1 h | 86% / 0 |
| 0.9 | 76% | 0 | 24 | 0.2 h | 81% / 0 |
| 0.95 | 61% | 0 | 39 | 0.2 h | 61% / 0 |
| 0.98 | 21% | 0 | 78 | 0.4 h | 21% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 4 | 100% |
| 0.70 - 0.89 | 10 | 100% |
| 0.90 - 0.94 | 20 | 100% |
| >= 0.95 | 60 | 100% |

## Agent errors and near misses

None.

## Cost and latency

99 agent calls, $0.90 total at list price ($0.009 per payment), average 4.6 s per call.
Average tokens per call: 2 input, 1,523 written to cache, 1,355 read from cache, 288 output (including thinking).
