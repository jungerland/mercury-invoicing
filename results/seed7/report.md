# Eval results

95 incoming payments against 161 open invoices across 30 customers. Synthetic data from `data/seed7/`. Model: `claude-opus-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 95 | 0 | 0 | 0 | 4.8 h |
| Rules baseline | 58% | 0 | 40 | 20 | 0 | 0 | 1.1 h |
| Agent + policy | 75% | 0 | 24 | 17 | 7 | 0 | 0.2 h |

- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 69 payments a careful human would apply without hesitation, rules handle 75% and the agent handles 94%.

## By scenario

| Scenario | Count | Rules | Agent |
|---|---|---|---|
| clean | 22 | 22/22 auto | 22/22 auto |
| garbled_memo | 10 | 10/10 auto | 10/10 auto |
| no_memo | 12 | 12/12 auto | 11/12 auto, 1 review (good guess) |
| not_invoice | 6 | 3/6 auto | 6/6 auto |
| different_payer | 9 | 8/9 auto | 8/9 auto, 1 review (shortlist) |
| multi_invoice | 9 | 0/9 auto | 6/9 auto, 3 review (good guess) |
| partial | 6 | 0/6 auto, 4 review (good guess) | 0/6 auto, 6 review (good guess) |
| wrong_reference | 4 | 0/4 auto, 4 review (good guess) | 0/4 auto, 3 review (good guess), 1 review (shortlist) |
| ambiguous | 5 | 0/5 auto | 0/5 auto, 5 review (shortlist) |
| overpayment | 4 | 0/4 auto, 4 review (good guess) | 0/4 auto, 4 review (good guess) |
| wire_fee | 8 | 0/8 auto, 8 review (good guess) | 8/8 auto |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 79% | 0 | 20 | 0.2 h | 93% / 1 |
| 0.7 | 79% | 0 | 20 | 0.2 h | 87% / 0 |
| 0.8 | 79% | 0 | 20 | 0.2 h | 87% / 0 |
| 0.85 | 78% | 0 | 21 | 0.2 h | 83% / 0 |
| 0.9 | 75% | 0 | 24 | 0.2 h | 78% / 0 |
| 0.95 | 48% | 0 | 49 | 0.3 h | 48% / 0 |
| 0.98 | 17% | 0 | 79 | 0.4 h | 17% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 6 | 83% |
| 0.70 - 0.89 | 9 | 100% |
| 0.90 - 0.94 | 28 | 100% |
| >= 0.95 | 46 | 100% |

## Agent errors and near misses

None.

## Cost and latency

95 agent calls, $1.56 total at list price ($0.016 per payment), average 4.8 s per call.
