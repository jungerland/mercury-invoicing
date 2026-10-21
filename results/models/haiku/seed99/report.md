# Eval results

99 incoming payments against 177 open invoices across 30 customers. Synthetic data from `data/seed99/`. Model: `claude-haiku-5-5` via cli. Policy threshold: 0.9.

## Headline

| Matcher | Hands-off | Wrong auto-applies | Review queue | ...correct suggestion | ...correct shortlist | Silently skipped | Human time |
|---|---|---|---|---|---|---|---|
| Status quo (all manual) | 0% | 0 | 99 | 0 | 0 | 0 | 5.0 h |
| Built-in: virtual account + exact amount | 31% | 0 | 0 | 0 | 0 | 68 | 3.4 h |
| Rules baseline | 59% | 0 | 41 | 17 | 0 | 0 | 1.3 h |
| Agent + policy | 49% | 0 | 50 | 36 | 10 | 0 | 0.5 h |

- **Built-in** follows Mercury's API docs: a transfer to a customer's virtual account number is marked paid on an exact-amount match. Anything it doesn't match waits until someone finds it ("silently skipped").
- **Hands-off**: handled correctly with no human touch (auto-applied, or correctly left alone because it wasn't an invoice payment).
- **Wrong auto-applies**: money put on the wrong invoice without a human seeing it. The number that has to stay at zero.
- **Human time** assumes 3 min to match a payment by hand, 0.25 min to confirm a correct suggestion, 1 min to pick from a shortlist, 20 min to unwind a wrong auto-apply. These are guesses to make the trade-off concrete, not measurements.
- Of the 72 payments a careful human would apply without hesitation, rules handle 76% and the agent handles 61%.
- 47 of 99 payments were sent to a customer's virtual account number. That share is an assumption; real traffic decides how much built-in matching covers.

## By scenario

| Scenario | Count | To virtual account | Built-in | Rules | Agent |
|---|---|---|---|---|---|
| twin_amount | 4 | 4 | 0/4 auto | 2/4 auto | 1/4 auto, 1 review (good guess), 1 review (shortlist) |
| multi_invoice | 9 | 3 | 0/9 auto | 0/9 auto | 4/9 auto, 4 review (good guess), 1 review (shortlist) |
| ambiguous | 5 | 0 | 0/5 auto | 0/5 auto | 0/5 auto, 3 review (shortlist) |
| clean | 22 | 11 | 11/22 auto | 22/22 auto | 19/22 auto, 3 review (good guess) |
| garbled_memo | 10 | 6 | 6/10 auto | 10/10 auto | 10/10 auto |
| partial | 6 | 4 | 0/6 auto | 0/6 auto, 3 review (good guess) | 0/6 auto, 5 review (good guess), 1 review (shortlist) |
| different_payer | 9 | 5 | 4/9 auto | 9/9 auto | 4/9 auto, 5 review (good guess) |
| no_memo | 12 | 3 | 3/12 auto | 12/12 auto | 4/12 auto, 8 review (good guess) |
| overpayment | 4 | 2 | 0/4 auto | 0/4 auto, 4 review (good guess) | 0/4 auto, 3 review (good guess), 1 review (shortlist) |
| wrong_reference | 4 | 3 | 1/4 auto | 0/4 auto, 2 review (good guess) | 0/4 auto, 3 review (shortlist) |
| wire_fee | 8 | 6 | 0/8 auto | 0/8 auto, 8 review (good guess) | 2/8 auto, 6 review (good guess) |
| not_invoice | 6 | 0 | 6/6 auto | 3/6 auto | 5/6 auto, 1 review (good guess) |

## Threshold sweep (agent)

Where to set the auto-apply bar is a product decision, not a model setting. Lower means more hands-off and more risk.

| Threshold | Hands-off | Wrong auto-applies | Review queue | Human time | Without guardrails: hands-off / wrong |
|---|---|---|---|---|---|
| 0.5 | 78% | 0 | 22 | 0.4 h | 86% / 0 |
| 0.7 | 78% | 0 | 22 | 0.4 h | 86% / 0 |
| 0.8 | 77% | 0 | 23 | 0.4 h | 83% / 0 |
| 0.85 | 74% | 0 | 26 | 0.4 h | 76% / 0 |
| 0.9 | 49% | 0 | 50 | 0.5 h | 51% / 0 |
| 0.95 | 15% | 0 | 84 | 0.7 h | 15% / 0 |
| 0.98 | 0% | 0 | 99 | 0.7 h | 0% / 0 |

"Without guardrails" trusts the model's decision whenever its confidence clears the bar, skipping the code checks in `policy.ts` (amounts reconcile, one customer, two independent signals, no partials or overpayments).

## Calibration

Is the agent's confidence trustworthy? For each band, how often its proposed allocation (invoices and residual type) was exactly right.

| Confidence | Proposals | Exactly right |
|---|---|---|
| < 0.70 | 0 | - |
| 0.70 - 0.89 | 35 | 100% |
| 0.90 - 0.94 | 35 | 100% |
| >= 0.95 | 15 | 100% |

## Agent errors and near misses

- **pay_002** (twin_amount, review_no_good_suggestion): expected inv_1175, agent proposed unsure at 0.45. Agent: "The payer is clearly Redwood Row Realty (cus_008), via its dedicated virtual account, and the $18,476.40 amount matches exactly. But two open invoices for this customer are the same amount, INV-1175 (due 2026-10-02) and INV-1044 (due 2026-10-15), and the memo is empty, so nothing in the record says which one this payment settles. Applying it to the wrong one would misstate the customer's balance, so a person should pick the invoice." Policy: Matcher unsure.
- **pay_023** (wrong_reference, review_no_good_suggestion): expected inv_1094, agent proposed unsure at 0.30. Agent: "The payment is $10,000 from Ironbark Capital, which is clearly cus_017 by its virtual account and known bank name. But the memo cites INV-1093, which is for $10,640, so paying it would leave a $640 short-pay that is too large to be a bank fee. Two other cus_017 invoices, INV-1094 and INV-1097, are exactly $10,000, so the amount points to one of them instead, and the evidence doesn't settle which invoice this is." Policy: Matcher unsure.
- **pay_047** (ambiguous, review_no_good_suggestion): expected inv_1022, agent proposed unsure at 0.10. Agent: "The payment is $1,200.00 by ACH from the generic originator "PAYMENTS" with no memo, and that name doesn't match any customer's known payer names. Eight open invoices are exactly $1,200.00 across different customers, so the amount alone can't identify which one was paid. A human should check the remittance or payer details before applying it." Policy: Matcher unsure.
- **pay_099** (ambiguous, review_no_good_suggestion): expected inv_1091, agent proposed unsure at 0.05. Agent: "Nothing identifies the payer: the memo is empty, the bank counterparty is only "MOBILE DEPOSIT", and none of the 11 customers' known payer names appear in the feed. Fifteen open invoices are exactly $10,000, so the amount alone cannot choose one, and the payment date (2026-11-15) is also after today's date (2026-10-21), which needs checking before anything is posted." Policy: Matcher unsure.

## Cost and latency

99 agent calls, $0.07 total at list price ($0.001 per payment), average 5.7 s per call.
Average tokens per call: 2 input, 1,591 written to cache, 1,355 read from cache, 818 output (including thinking).
