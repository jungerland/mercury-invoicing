# Eval results

95 incoming payments against 164 open invoices across 30 customers. Synthetic data from `data/`. Model: `claude-opus-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 95 | 0 | 0 | 0 | 4.8 h |
| Rules baseline | 60% | 0 | 38 | 19 | 0 | 0 | 1.0 h |
| Agent + policy | 69% | 0 | 29 | 21 | 8 | 0 | 0.2 h |

- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 70 payments a careful human would apply without hesitation, rules handle 76% and the agent handles 86%.

## By scenario

| Scenario | Count | Rules | Agent |
|---|---|---|---|
| no_memo | 12 | 12/12 auto | 10/12 auto, 2 review (good guess) |
| wire_fee | 8 | 0/8 auto, 8 review (good guess) | 8/8 auto |
| different_payer | 9 | 9/9 auto | 6/9 auto, 3 review (good guess) |
| partial | 6 | 0/6 auto, 3 review (good guess) | 0/6 auto, 6 review (good guess) |
| ambiguous | 5 | 0/5 auto | 0/5 auto, 5 review (shortlist) |
| clean | 22 | 22/22 auto | 22/22 auto |
| not_invoice | 6 | 4/6 auto | 6/6 auto |
| garbled_memo | 10 | 10/10 auto | 10/10 auto |
| wrong_reference | 4 | 0/4 auto, 4 review (good guess) | 0/4 auto, 1 review (good guess), 3 review (shortlist) |
| multi_invoice | 9 | 0/9 auto | 4/9 auto, 5 review (good guess) |
| overpayment | 4 | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (good guess) |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 80% | 0 | 19 | 0.2 h | 92% / 0 |
| 0.7 | 80% | 0 | 19 | 0.2 h | 89% / 0 |
| 0.8 | 80% | 0 | 19 | 0.2 h | 88% / 0 |
| 0.85 | 79% | 0 | 20 | 0.2 h | 83% / 0 |
| 0.9 | 69% | 0 | 29 | 0.2 h | 74% / 0 |
| 0.95 | 45% | 0 | 52 | 0.3 h | 45% / 0 |
| 0.98 | 11% | 0 | 85 | 0.5 h | 11% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 2 | 100% |
| 0.70 - 0.89 | 15 | 100% |
| 0.90 - 0.94 | 27 | 100% |
| >= 0.95 | 43 | 100% |

## Agent errors and near misses

None.

## Cost and latency

95 agent calls, $1.66 total at list price ($0.017 per payment), average 4.9 s per call.
