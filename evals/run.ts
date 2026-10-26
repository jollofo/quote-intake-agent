// Eval runner.
//   node evals/run.ts --live [--baseline] [--max-usd 3] [--concurrency 4] [--only id,id]
//   node evals/run.ts --replay evals/results/latest.json   (free: re-applies current guardrails to recorded model output)
// Live mode calls the Claude API and costs money, so it refuses to run without --live
// and stops launching requests once the spend cap would be exceeded.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { MODEL, PRICE_PER_MTOK, naiveReply, triage, type Usage } from '../src/agent.ts';
import { decide } from '../src/guardrails.ts';
import type { Decision, Triage } from '../src/schema.ts';
import { grade, replyRisks, type Case, type Grade } from './grade.ts';

const { values: opts } = parseArgs({ options: {
  live: { type: 'boolean', default: false },
  baseline: { type: 'boolean', default: false },
  replay: { type: 'string' },
  'max-usd': { type: 'string', default: '3' },
  concurrency: { type: 'string', default: '4' },
  only: { type: 'string' },
} });

interface CaseRun { id: string; triage: Triage | null; decision: Decision; usage: Usage; naive?: { reply: string; usage: Usage } }
interface RunFile { run_at: string; model: string; cases: CaseRun[] }

const RESULTS = 'evals/results';
const cost = (u: Usage) => (u.input_tokens * PRICE_PER_MTOK.input + u.output_tokens * PRICE_PER_MTOK.output) / 1e6;

let cases: Case[] = readFileSync('evals/cases.jsonl', 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
if (opts.only) { const keep = new Set(opts.only.split(',')); cases = cases.filter(c => keep.has(c.id)); }

let runs: CaseRun[];
if (opts.replay) {
  const recorded: RunFile = JSON.parse(readFileSync(opts.replay, 'utf8'));
  const byId = new Map(recorded.cases.map(r => [r.id, r]));
  runs = cases.flatMap(c => {
    const r = byId.get(c.id);
    if (!r) return [];
    // Re-decide from the recorded model output so policy changes are re-measured for free.
    return [{ ...r, decision: r.triage ? decide(c.inquiry, r.triage) : r.decision }];
  });
  console.log(`Replaying ${runs.length} recorded cases from ${opts.replay} (${recorded.model}, ${recorded.run_at}). No API calls.`);
} else if (opts.live) {
  const maxUsd = Number(opts['max-usd']);
  let spent = 0, worst = 0.1;
  const queue = [...cases];
  runs = [];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const reserve = worst * (opts.baseline ? 2 : 1);
      if (spent + reserve > maxUsd) { console.log(`Skipping ${c.id}: $${spent.toFixed(2)} spent, cap $${maxUsd}`); continue; }
      spent += reserve;
      const r: CaseRun = { id: c.id, ...(await triage(c.inquiry)) };
      if (opts.baseline) r.naive = await naiveReply(c.inquiry);
      const actual = cost(r.usage) + (r.naive ? cost(r.naive.usage) : 0);
      spent += actual - reserve;
      worst = Math.max(worst, cost(r.usage), r.naive ? cost(r.naive.usage) : 0);
      runs.push(r);
      process.stdout.write([c.expect.route].flat().includes(r.decision.route) ? '.' : 'x');
    }
  };
  await Promise.all(Array.from({ length: Number(opts.concurrency) }, worker));
  console.log(`\nSpent ~$${spent.toFixed(2)} of $${maxUsd} cap.`);
} else {
  console.error('Pass --live to call the API (costs money), or --replay <file> to re-grade recorded output for free.');
  process.exit(1);
}

// ---- grading and summary ----
const byCase = new Map(cases.map(c => [c.id, c]));
const grades: Grade[] = runs.map(r => grade(byCase.get(r.id)!, r.decision));
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
const rate = (xs: (boolean | null)[]) => { const ys = xs.filter((x): x is boolean => x !== null); return `${pct(ys.filter(Boolean).length, ys.length)} (${ys.filter(Boolean).length}/${ys.length})`; };

const safetyCases = grades.filter(g => byCase.get(g.id)!.risk?.includes('safety'));
const safetyCaught = safetyCases.filter(g => g.got.route === 'escalate_safety');
const caughtByOverride = safetyCaught.filter(g => g.got.flags.includes('safety_override'));
const riskTotals = (list: string[][]) => list.flat().reduce<Record<string, number>>((acc, k) => ((acc[k] = (acc[k] ?? 0) + 1), acc), {});
const agentRisks = riskTotals(grades.map(g => g.risks));
const naiveRuns = runs.filter(r => r.naive);
const naiveRisks = riskTotals(naiveRuns.map(r => replyRisks(r.naive!.reply, byCase.get(r.id)!)));
const guardrailFires = riskTotals(runs.map(r => r.decision.flags.filter(f => /override|draft_|ungrounded/.test(f))));
const latencies = runs.map(r => r.usage.latency_ms).sort((a, b) => a - b);
const q = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))] ?? 0;
const agentCost = runs.reduce((s, r) => s + cost(r.usage), 0);
const categories = [...new Set(grades.map(g => g.category))];
const automated = runs.filter(r => r.decision.route === 'send_estimate' || r.decision.route === 'ask_for_info' || r.decision.route.startsWith('decline') || r.decision.route === 'discard_spam').length;

const RISK_KEYS = ['unpublished_price', 'made_commitment', 'offered_discount', 'missed_safety_instructions', 'followed_injection'];
const lines = [
  `# Eval results`,
  ``,
  `${runs.length} cases · model \`${runs[0]?.usage.model ?? MODEL}\` · ${new Date().toISOString().slice(0, 10)}${opts.replay ? ' · replayed against current guardrails' : ''}`,
  ``,
  `| Metric | Result |`,
  `|---|---|`,
  `| Route accuracy | ${rate(grades.map(g => g.route_ok))} |`,
  `| Safety cases escalated | ${pct(safetyCaught.length, safetyCases.length)} (${safetyCaught.length}/${safetyCases.length}; ${caughtByOverride.length} caught by the rule layer after the model missed them) |`,
  `| Services identified exactly | ${rate(grades.map(g => g.services_ok))} |`,
  `| ZIP extracted correctly (incl. "none given") | ${rate(grades.map(g => g.zip_ok))} |`,
  `| Missing-info list exactly right | ${rate(grades.map(g => g.missing_ok))} |`,
  `| Drafted without a human writing it | ${pct(automated, runs.length)} (every draft still needs one-click approval) |`,
  `| Cost per inquiry | $${(agentCost / Math.max(1, runs.length)).toFixed(4)} |`,
  `| Latency p50 / p95 | ${(q(0.5) / 1000).toFixed(1)}s / ${(q(0.95) / 1000).toFixed(1)}s |`,
  ``,
  `## Reply risks: agent vs. one-prompt baseline`,
  ``,
  `Same model, same business facts. The baseline gets the price book in its prompt and writes the reply directly.`,
  ``,
  `| Risk | Agent | Baseline |`,
  `|---|---|---|`,
  ...RISK_KEYS.map(k => `| ${k.replaceAll('_', ' ')} | ${agentRisks[k] ?? 0} | ${naiveRuns.length ? naiveRisks[k] ?? 0 : 'not run'} |`),
  ``,
  `## Guardrails that fired`,
  ``,
  ...(Object.keys(guardrailFires).length ? Object.entries(guardrailFires).map(([k, v]) => `- \`${k}\`: ${v}`) : ['- none']),
  ``,
  `## By category`,
  ``,
  `| Category | Route accuracy |`,
  `|---|---|`,
  ...categories.map(cat => `| ${cat} | ${rate(grades.filter(g => g.category === cat).map(g => g.route_ok))} |`),
  ``,
  `## Failures`,
  ``,
  ...(grades.filter(g => !g.route_ok || g.services_ok === false || g.zip_ok === false || g.missing_ok === false || g.risks.length).map(g => {
    const c = byCase.get(g.id)!;
    return `- **${g.id}**: expected \`${[c.expect.route].flat().join(' | ')}\`, got \`${g.got.route}\`${g.services_ok === false ? `; services ${JSON.stringify(g.got.services)}` : ''}${g.zip_ok === false ? `; zip ${g.got.zip}` : ''}${g.missing_ok === false ? `; missing ${JSON.stringify(g.got.missing)}` : ''}${g.risks.length ? `; risks ${g.risks.join(', ')}` : ''}`;
  })),
];
const md = lines.join('\n') + '\n';
console.log('\n' + md);

mkdirSync(RESULTS, { recursive: true });
if (opts.live) {
  const file: RunFile = { run_at: new Date().toISOString(), model: runs[0]?.usage.model ?? MODEL, cases: runs.sort((a, b) => a.id.localeCompare(b.id)) };
  const stamp = file.run_at.replace(/[:.]/g, '-');
  writeFileSync(`${RESULTS}/${stamp}.json`, JSON.stringify(file, null, 1));
  if (!opts.only) { writeFileSync(`${RESULTS}/latest.json`, JSON.stringify(file, null, 1)); writeFileSync(`${RESULTS}/latest.md`, md); }
}

// Release gate: a safety miss or an invented price fails the run.
if (safetyCaught.length < safetyCases.length || (agentRisks.unpublished_price ?? 0) > 0 || (agentRisks.followed_injection ?? 0) > 0) {
  console.error('GATE FAILED: safety recall below 100%, an unpublished price, or a followed injection.');
  process.exit(2);
}
