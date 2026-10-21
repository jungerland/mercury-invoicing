# Payment Auto-Match

An agent that matches incoming bank payments to open invoices. A customer's virtual account number already matches a payment that arrives for the exact amount. This handles the rest: wire fees, partials, overpayments, batch payments, two invoices at the same amount, and payments sent to the main account number. It applies the matches it can prove and gives a person a short, explained queue for everything else.

Built as a working demo for a Senior PM, Invoicing role. The goal it answers comes from the job posting: incoming payments should "match themselves to the right invoice without anyone lifting a finger," using AI "without chasing hype."

**Live demo:** https://claude.ai/artifact/W5w7goumjU1Hdasa35nqAR (private until shared)
**Product memo:** [MEMO.md](MEMO.md)

## Results

99 incoming payments against about 165 open invoices across 30 fictional businesses, on two independently generated datasets. Policy bar 0.90.

| | Hands-off | Wrong auto-applies | Human time |
|---|---|---|---|
| By hand | 0% | 0 | 5.0 h |
| Built-in: virtual account + exact amount (dataset A / B) | 40% / 34% | 0 / 0 | 3.0 h / 3.3 h |
| Rules baseline (dataset A / B) | 61% / 60% | 0 / 0 | 1.0 h / 1.1 h |
| Agent + guardrails (dataset A / B) | 71% / 78% | 0 / 0 | 0.2 h / 0.2 h |

At a 0.80 bar the agent reaches 79% and 80% hands-off, still with zero wrong auto-applies.

**Held-out check.** Datasets A and B were the ones used while building the agent. To rule out overfitting, a third dataset (seed 99) was generated afterward and run live with no changes to prompts or policy. Results held: built-in 31%, rules 59%, agent 70% hands-off at the 0.90 bar (78% at 0.80), zero wrong auto-applies at every threshold. Without the guardrails in `policy.ts`, the model made one wrong auto-apply at a 0.50 bar; the guardrails caught it. Report: [results/seed99/report.md](results/seed99/report.md).

"Built-in" follows Mercury's public API docs; about 55% of invoice payments in the data arrive on a virtual account number, which is an assumption. Full reports, with per-scenario breakdowns, a threshold sweep, a guardrail ablation and a calibration table: [results/report.md](results/report.md), [results/seed7/report.md](results/seed7/report.md).

**Re-run.** All three datasets were run live a second time (2026-10-20) to record token counts. Agent hands-off moved by a point at most, and wrong auto-applies stayed at zero.

Cost: about $0.014 and 5 seconds per payment on Claude Opus 5.5 at list price, with the shared system prompt cached. Runs through the `claude` CLI cost about $0.020, because the CLI also writes each payment's prompt to a 1-hour cache at twice the input price. Each cache entry stores token counts, and the demo page projects monthly cost from them.

## How it works

```
bank payment
   │
   ▼
1. Gather evidence (code)       src/match/candidates.ts
   which account number it arrived on, invoice numbers recovered from messy memos, known payer names,
   exact amounts, same-customer invoice combinations that sum to the deposit
   │
   ▼
2. Propose (model)              src/match/agent.ts
   which invoices, any fee/partial/overpayment, calibrated confidence,
   one sentence a business owner can read
   │
   ▼
3. Decide (code)                src/match/policy.ts
   auto-apply only if: confident, amounts reconcile to the cent,
   one customer, two independent signals, nothing else fits as well,
   no partials or overpayments
   │
   ▼
4. Auto-apply, or queue with a suggestion
```

The model never does arithmetic, and it never moves money on its own say-so. The rules baseline (`src/match/rules.ts`) uses the same evidence, so the comparison is fair. The built-in baseline (`src/match/builtin.ts`) models documented virtual-account matching.

## Run it

Requires Node 23.6+ (runs TypeScript directly, no build step).

```bash
npm install
npm run eval        # scores rules + agent, writes results/report.md
npm run ui          # bakes results into ui/index.html
```

Agent responses are cached in `results/agent_cache.json`, so `npm run eval` reproduces the committed reports without calling a model. That checks the scoring, not the agent. To test the agent live, point `RESULTS_DIR` at an empty folder (`--limit 12` makes a quick smoke test, about $0.25).

The agent calls Claude through the Anthropic SDK when `ANTHROPIC_API_KEY` is set. Otherwise it falls back to the local `claude` CLI in headless mode.

Other datasets:

```bash
DATA_DIR=data/seed7 node src/data/generate.ts 7
DATA_DIR=data/seed7 RESULTS_DIR=results/seed7 npm run eval
```

## Data

`src/data/generate.ts` builds a seeded, synthetic AR ledger: customers with names they have paid from before (parent companies, founders' personal accounts, AP platforms, processor payouts), open invoices, and a day's bank feed covering twelve scenarios. These are clean references, empty memos, mangled references, wire fees, batch payments, partials, other-entity payers, look-alike amounts, overpayments, memos citing the wrong invoice, two open invoices at the same amount, and deposits that aren't invoice payments at all. Each payment arrives either on the customer's virtual account number or on the main account number.

Every payment has a ground-truth answer and an ideal action (auto, review, or leave alone). The data is synthetic and was written by the same person who built the agent. Real bank feeds will be messier. The next step is shadow mode on real traffic.
