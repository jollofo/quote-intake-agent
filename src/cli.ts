// Triage one inquiry from an argument or stdin and print the decision.
// Usage: npm run intake -- "My furnace is making a banging noise, 14610, 585-555-0101"
import { readFileSync } from 'node:fs';
import { triage } from './agent.ts';

const inquiry = process.argv.slice(2).join(' ') || readFileSync(0, 'utf8');
if (!inquiry.trim()) {
  console.error('Pass an inquiry as an argument or on stdin.');
  process.exit(1);
}
const { decision, usage } = await triage(inquiry);
console.log(`Route: ${decision.route}`);
console.log(`Services: ${decision.services.join(', ') || '-'} | ZIP: ${decision.zip ?? '-'} | Missing: ${decision.missing.join(', ') || '-'}`);
console.log(`Flags: ${decision.flags.join(', ') || '-'}`);
console.log(`Staff note: ${decision.staff_note}`);
console.log(`\n--- Draft for approval ---\n${decision.reply ?? '(no reply; route to staff)'}`);
console.log(`\n${usage.model} · ${usage.input_tokens} in / ${usage.output_tokens} out · ${usage.latency_ms} ms`);
