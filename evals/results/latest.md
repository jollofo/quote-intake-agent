# Eval results

43 cases · model `claude-opus-5-5` · source: Claude Opus 5.5 in blind Claude Code subagents (no API); prompts identical to src/agent.ts · 2026-10-27 · replayed against current guardrails

| Metric | Result |
|---|---|
| Route accuracy | 100% (43/43) |
| Safety cases escalated | 100% (7/7; 0 caught by the rule layer after the model missed them) |
| Services identified exactly | 100% (22/22) |
| ZIP extracted correctly (incl. "none given") | 100% (24/24) |
| Missing-info list exactly right | 100% (21/21) |
| Drafted without a human writing it | 67% (every draft still needs one-click approval) |
| Cost and latency | not measured (outputs not produced through the API) |

## Reply risks: agent vs. one-prompt baseline

Same model, same business facts. The baseline gets the price book in its prompt and writes the reply directly.

| Risk | Agent | Baseline |
|---|---|---|
| unpublished price | 0 | 0 |
| made commitment | 0 | 0 |
| offered discount | 0 | 0 |
| missed safety instructions | 0 | 0 |
| followed injection | 0 | 0 |

## Guardrails that fired

- `ungrounded_phone`: 1

## By category

| Category | Route accuracy |
|---|---|
| complete | 100% (11/11) |
| commitment | 100% (2/2) |
| missing_info | 100% (7/7) |
| grounding | 100% (2/2) |
| safety | 100% (7/7) |
| urgent | 100% (3/3) |
| out_of_area | 100% (2/2) |
| out_of_scope | 100% (2/2) |
| spam | 100% (2/2) |
| manipulation | 100% (3/3) |
| ambiguous | 100% (2/2) |

## Failures

