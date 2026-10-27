// Run the evals without API credits by having another Claude session play the model.
//   node evals/offline.ts export <dir>                      writes the prompts and the inquiries (no labels)
//   node evals/offline.ts import <agent.jsonl> [baseline.jsonl] [source description]
// Then `npm run eval:replay` grades the imported outputs with the real schema, guardrails and graders.
// agent.jsonl lines: {"id": "...", "output": <JSON object matching schema.json>}
// baseline.jsonl lines: {"id": "...", "reply": "..."}
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MODEL, NAIVE_SYSTEM, SYSTEM, type Usage } from '../src/agent.ts';
import { decide } from '../src/guardrails.ts';
import { Triage, TRIAGE_JSON_SCHEMA, type Decision } from '../src/schema.ts';
import { loadCases, type Case } from './grade.ts';

const [mode, ...rest] = process.argv.slice(2);
const cases: Case[] = loadCases();
const OUT = process.env.EVAL_RESULTS ?? 'evals/results/latest.json';
const readJsonl = (p: string) => readFileSync(p, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
const noUsage: Usage = { input_tokens: 0, output_tokens: 0, latency_ms: 0, model: MODEL };

if (mode === 'export') {
  const dir = rest[0];
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/system-agent.txt`, SYSTEM);
  writeFileSync(`${dir}/system-baseline.txt`, NAIVE_SYSTEM);
  writeFileSync(`${dir}/schema.json`, JSON.stringify(TRIAGE_JSON_SCHEMA, null, 1));
  // Inquiries only: the expected answers stay in cases.jsonl.
  writeFileSync(`${dir}/inputs.jsonl`, cases.map(c => JSON.stringify({ id: c.id, inquiry: c.inquiry })).join('\n') + '\n');
  console.log(`Wrote prompts, schema and ${cases.length} inquiries to ${dir}`);
} else if (mode === 'import') {
  const [agentPath, baselinePath, source = 'Claude Code session standing in for the API'] = rest;
  const outputs = new Map(readJsonl(agentPath).map(r => [r.id, r.output]));
  const replies = baselinePath ? new Map(readJsonl(baselinePath).map(r => [r.id, r.reply as string])) : new Map<string, string>();
  const failClosed = (flag: string): Decision => ({ route: 'escalate_human', reply: null, services: [], zip: null, missing: [], flags: [flag], staff_note: '' });
  const runs = cases.filter(c => outputs.has(c.id)).map(c => {
    const parsed = Triage.safeParse(outputs.get(c.id));
    return {
      id: c.id,
      triage: parsed.success ? parsed.data : null,
      decision: parsed.success ? decide(c.inquiry, parsed.data) : failClosed('model_invalid_output'),
      usage: noUsage,
      ...(replies.has(c.id) ? { naive: { reply: replies.get(c.id)!, usage: noUsage } } : {}),
    };
  });
  const invalid = runs.filter(r => !r.triage).map(r => r.id);
  mkdirSync('evals/results', { recursive: true });
  writeFileSync(OUT, JSON.stringify({ run_at: new Date().toISOString(), model: MODEL, source, cases: runs }, null, 1));
  console.log(`Imported ${runs.length} of ${cases.length} cases (${invalid.length} failed the schema${invalid.length ? `: ${invalid.join(', ')}` : ''}), ${replies.size} baseline replies.`);
} else {
  console.error('Usage: node evals/offline.ts export <dir> | import <agent.jsonl> [baseline.jsonl] [source]');
  process.exit(1);
}
