# Payment Auto-Match

An agent that matches incoming bank payments to open invoices. It applies the matches it can prove and gives a person a short, explained queue for the rest.

Built as a working demo for a Senior PM, Invoicing role. The goal it answers comes from the job posting: incoming payments should "match themselves to the right invoice without anyone lifting a finger," using AI "without chasing hype."

**Live demo:** https://claude.ai/artifact/W5w7goumjU1Hdasa35nqAR (private until shared)
**Product memo:** [MEMO.md](MEMO.md)

## Results

95 incoming payments against about 160 open invoices across 30 fictional businesses, on two independently generated datasets. Policy bar 0.90.

| | Hands-off | Wrong auto-applies | Human time |
|---|---|---|---|
| By hand | 0% | 0 | 4.8 h |
| Rules engine (dataset A / B) | 60% / 58% | 0 / 0 | 1.0 h / 1.1 h |
| Agent + guardrails (dataset A / B) | 69% / 75% | 0 / 0 | 0.2 h / 0.2 h |

At a 0.80 bar the agent reaches 79–80% hands-off on both datasets, still with zero wrong auto-applies. Full reports, with per-scenario breakdowns, a threshold sweep, a guardrail ablation and a calibration table: [results/report.md](results/report.md), [results/seed7/report.md](results/seed7/report.md).

Cost: about $0.017 and 5 seconds per payment on Claude Opus 5.5.

## How it works

```
bank payment
   │
   ▼
1. Gather evidence (code)       src/match/candidates.ts
   invoice numbers recovered from messy memos, known payer names,
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
   one customer, two independent signals, no partials or overpayments
   │
   ▼
4. Auto-apply, or queue with a suggestion
```

The model never does arithmetic, and it never moves money on its own say-so. The rules baseline (`src/match/rules.ts`) uses the same evidence, so the comparison is fair.

## Run it

Requires Node 23.6+ (runs TypeScript directly, no build step).

```bash
npm install
npm run eval        # scores rules + agent, writes results/report.md
npm run ui          # bakes results into ui/index.html
```

Agent responses are cached in `results/agent_cache.json`, so `npm run eval` reproduces the committed reports without calling a model. Delete the cache to re-run live.

The agent calls Claude through the Anthropic SDK when `ANTHROPIC_API_KEY` is set. Otherwise it falls back to the local `claude` CLI in headless mode.

Other datasets:

```bash
DATA_DIR=data/seed7 node src/data/generate.ts 7
DATA_DIR=data/seed7 RESULTS_DIR=results/seed7 npm run eval
```

## Data

`src/data/generate.ts` builds a seeded, synthetic AR ledger: customers with names they have paid from before (parent companies, founders' personal accounts, AP platforms, processor payouts), open invoices, and a day's bank feed covering eleven scenarios. These are clean references, empty memos, mangled references, wire fees, batch payments, partials, other-entity payers, look-alike amounts, overpayments, memos citing the wrong invoice, and deposits that aren't invoice payments at all.

Every payment has a ground-truth answer and an ideal action (auto, review, or leave alone). The data is synthetic and was written by the same person who built the agent. Real bank feeds will be messier. The next step is shadow mode on real traffic.
