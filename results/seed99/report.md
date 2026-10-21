# Eval results

99 incoming payments against 177 open invoices across 30 customers. Synthetic data from `data/seed99/`. Model: `claude-opus-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 99 | 0 | 0 | 0 | 5.0 h |
| Built-in: virtual account + exact amount | 31% | 0 | 0 | 0 | 0 | 68 | 3.4 h |
| Rules baseline | 59% | 0 | 41 | 17 | 0 | 0 | 1.3 h |
| Agent + policy | 70% | 0 | 30 | 20 | 10 | 0 | 0.3 h |

- **Built-in** follows Mercury's API docs: a transfer to a customer's virtual account number is marked paid on an exact-amount match. Anything it doesn't match waits until someone finds it ("silently skipped").
- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 72 payments a careful human would apply without hesitation, rules handle 76% and the agent handles 88%.
- 47 of 99 payments were sent to a customer's virtual account number. That share is an assumption; real traffic decides how much built-in matching covers.

## By scenario

| Scenario | Count | To virtual account | Built-in | Rules | Agent |
|---|---|---|---|---|---|
| twin_amount | 4 | 4 | 0/4 auto | 2/4 auto | 2/4 auto, 1 review (good guess), 1 review (shortlist) |
| multi_invoice | 9 | 3 | 0/9 auto | 0/9 auto | 6/9 auto, 2 review (good guess), 1 review (shortlist) |
| ambiguous | 5 | 0 | 0/5 auto | 0/5 auto | 0/5 auto, 5 review (shortlist) |
| clean | 22 | 11 | 11/22 auto | 22/22 auto | 22/22 auto |
| garbled_memo | 10 | 6 | 6/10 auto | 10/10 auto | 10/10 auto |
| partial | 6 | 4 | 0/6 auto | 0/6 auto, 3 review (good guess) | 0/6 auto, 6 review (good guess) |
| different_payer | 9 | 5 | 4/9 auto | 9/9 auto | 6/9 auto, 3 review (good guess) |
| no_memo | 12 | 3 | 3/12 auto | 12/12 auto | 12/12 auto |
| overpayment | 4 | 2 | 0/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (good guess) |
| wrong_reference | 4 | 3 | 1/4 auto | 0/4 auto, 2 review (good guess) | 0/4 auto, 1 review (good guess), 3 review (shortlist) |
| wire_fee | 8 | 6 | 0/8 auto | 0/8 auto, 8 review (good guess) | 5/8 auto, 3 review (good guess) |
| not_invoice | 6 | 0 | 6/6 auto | 3/6 auto | 6/6 auto |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 78% | 0 | 22 | 0.2 h | 90% / 1 |
| 0.7 | 78% | 0 | 22 | 0.2 h | 88% / 0 |
| 0.8 | 78% | 0 | 22 | 0.2 h | 87% / 0 |
| 0.85 | 77% | 0 | 23 | 0.2 h | 83% / 0 |
| 0.9 | 70% | 0 | 30 | 0.3 h | 73% / 0 |
| 0.95 | 47% | 0 | 52 | 0.3 h | 48% / 0 |
| 0.98 | 7% | 0 | 92 | 0.5 h | 7% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 3 | 67% |
| 0.70 - 0.89 | 15 | 100% |
| 0.90 - 0.94 | 24 | 100% |
| >= 0.95 | 48 | 100% |

## Agent errors and near misses

None.

## Cost and latency

99 agent calls, $2.02 total at list price ($0.020 per payment), average 5.4 s per call.
Average tokens per call: 2 input, 1,557 written to cache, 1,427 read from cache, 382 output (including thinking).
