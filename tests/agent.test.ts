import assert from 'node:assert/strict';
import { test } from 'node:test';
import type Anthropic from '@anthropic-ai/sdk';
import { triage } from '../src/agent.ts';

// A stand-in client that returns a canned response; no network.
const stub = (response: object) => ({ beta: { messages: { create: async () => response } } }) as unknown as Anthropic;
const usage = { input_tokens: 10, output_tokens: 5 };

test('a refusal fails closed to a human', async () => {
  const r = await triage('hello', stub({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [], usage, model: 'm' }));
  assert.equal(r.decision.route, 'escalate_human');
  assert.deepEqual(r.decision.flags, ['model_refusal']);
});

test('truncated output fails closed', async () => {
  const r = await triage('hello', stub({ stop_reason: 'max_tokens', content: [], usage, model: 'm' }));
  assert.deepEqual(r.decision.flags, ['model_truncated']);
});

test('malformed JSON and schema-invalid JSON both fail closed', async () => {
  const bad = await triage('hello', stub({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{not json' }], usage, model: 'm' }));
  assert.deepEqual(bad.decision.flags, ['model_invalid_json']);
  const wrong = await triage('hello', stub({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"services": "drain"}' }], usage, model: 'm' }));
  assert.deepEqual(wrong.decision.flags, ['model_invalid_output']);
});
