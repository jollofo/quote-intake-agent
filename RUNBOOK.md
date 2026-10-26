# Runbook

How to operate the intake agent for a business, and what to do when it misbehaves. Written for the dispatcher who approves drafts and the engineer who maintains the deployment.

## What the agent is allowed to do

| It can | It cannot |
|---|---|
| Read an inquiry and draft a reply | Send anything. Every reply is a draft a person approves |
| Pick services from the price book | Invent a service, a price, a discount, an arrival time or a guarantee |
| Ask for the information the price book requires | Decide what information is "enough" (code does) |
| Flag safety, urgency, spam and manipulation | Override a safety rule. A keyword hit always escalates |

If the model errors, refuses, truncates, or returns output that fails the schema, the inquiry goes to a person with a `model_*` flag. Nothing is dropped silently.

## Daily operation (dispatcher)

1. Work the queue by route, in this order: `escalate_safety` → `escalate_urgent` → `escalate_human` → everything else.
2. **`escalate_safety`**: the customer has been told to leave and call 911 or the utility. Call them back from the emergency line as soon as possible. Never just approve the draft and move on.
3. **`escalate_urgent`**: call back within 15 minutes. No draft is generated on purpose.
4. **`ask_for_info` / `send_estimate`**: read the draft, check the staff note, approve or edit. Prices in the draft come from the price book. If a price looks wrong, the price book is wrong. Fix it there (see below), not in the draft.
5. **`decline_*`**: approve unless you know the customer, or the job is worth an exception.
6. **`discard_spam`**: skim weekly for false positives.

Flags worth knowing:

| Flag | Meaning | Action |
|---|---|---|
| `safety_override` | The rule layer caught a hazard the model missed | None needed. Report it so the case is added to the evals |
| `draft_invented_price` / `draft_made_commitment` | The model tried to state a price or promise a time; the reply was replaced with a template | Approve the template or personalize it |
| `needs_translation` / `details_in_english` | Customer wrote in another language; part or all of the reply is English | Translate before sending |
| `ungrounded_zip` / `ungrounded_phone` / `ungrounded_email` | The model "found" a value the customer never typed; it was discarded | Confirm with the customer |
| `partial_scope` | Some of the request is work we don't do | Say so in the reply |
| `model_refusal`, `model_api_error`, `model_invalid_*` | The model failed; nothing was drafted | Handle manually. If several appear in a row, page the engineer |

## Changing business facts (engineer)

Everything the business controls lives in `src/business.ts`: price book, service area ZIPs, required information per service, hours, and the safety script.

1. Edit `src/business.ts`.
2. `npm run check` (typecheck + guardrail tests, free).
3. `npm run eval:replay` re-grades the last recorded model outputs against the new rules, also free. If a rule change breaks a labelled case, fix the rule or update the label with a reason in the commit.
4. If the change affects what the model has to read (new service codes, new safety categories), run a live eval (below) before deploying.

## Running the evals

```bash
npm run check                                   # free: 19 unit tests on guardrails and failure handling
npm run eval:replay                             # free: re-grade recorded outputs with current rules
npm run eval -- --live --max-usd 3              # paid: run the agent on all cases, stop at $3
npm run eval -- --live --baseline --max-usd 6   # paid: also run the one-prompt baseline for comparison
```

The run exits non-zero (`GATE FAILED`) if any safety case is not escalated, any reply contains a price that is not in the price book, or a reply follows an injected instruction. Treat that as a release blocker.

## When something goes wrong

**A customer was quoted a wrong price.** Check whether the dollar figure is in `PRICE_BOOK`. If it is, the price book is out of date. If it isn't, that is a guardrail bug: add the reply text as a unit test in `tests/guardrails.test.ts`, fix the `MONEY` pattern, and add the inquiry to `evals/cases.jsonl`.

**A hazard was not escalated.** Highest severity. Add the customer's wording to `SAFETY_PATTERNS` in `src/guardrails.ts`, add the inquiry to `evals/cases.jsonl` with `"risk":["safety"]`, and run `npm run check` and `npm run eval:replay`. The keyword layer exists so this fix never depends on the model.

**Too many inquiries land in `escalate_human`.** Look at the flags. `low_confidence` and `no_service_identified` usually mean the price book is missing a service customers ask for. Add it, with its `needs`.

**Cost or latency jumps.** The eval report prints cost per inquiry and p50/p95 latency. Compare `evals/results/latest.md` with the previous run. Effort is set in `src/agent.ts`, and lowering it is the first lever. Re-run the evals before and after any change.

## Limits

- The eval set is 43 hand-written inquiries, not production traffic. Add real ones (with personal details removed) as they come in. That is the most valuable maintenance task.
- Keyword safety patterns cover English and a little Spanish. Other languages rely on the model alone.
- The agent sees text only. Photos are requested but not analyzed.
