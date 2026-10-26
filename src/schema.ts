import { z } from 'zod';
import { SERVICE_CODES, type InfoKey, type ServiceCode } from './business.ts';

const INFO_KEYS = ['address_or_zip', 'phone_or_email', 'equipment_age', 'photos', 'access_details', 'fixture_count', 'preferred_time'] as const satisfies readonly InfoKey[];

// What the model returns. It reads and writes; it does not decide routing.
export const Triage = z.object({
  services: z.array(z.object({
    code: z.enum(['other', ...SERVICE_CODES] as [ServiceCode | 'other', ...(ServiceCode | 'other')[]]),
    description: z.string(),
  })),
  urgency: z.enum(['emergency', 'same_day', 'routine']),
  safety_concern: z.boolean(),
  safety_reason: z.string(),
  zip: z.string().nullable(),
  contact: z.object({ name: z.string().nullable(), phone: z.string().nullable(), email: z.string().nullable() }),
  provided: z.array(z.enum(INFO_KEYS)),
  is_spam: z.boolean(),
  manipulation_attempt: z.boolean(),
  language: z.string(),
  reply_draft: z.string(),
  staff_note: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type Triage = z.infer<typeof Triage>;

const { $schema: _draft, ...jsonSchema } = z.toJSONSchema(Triage) as Record<string, unknown>;
export const TRIAGE_JSON_SCHEMA = jsonSchema;

export type Route =
  | 'escalate_safety'      // possible danger: operator safety script, staff paged
  | 'escalate_urgent'      // active damage or no heat/water: staff calls back now
  | 'escalate_human'       // ambiguous, manipulative, low confidence, or the model failed
  | 'decline_out_of_area'
  | 'decline_out_of_scope'
  | 'discard_spam'
  | 'ask_for_info'         // draft asks for what the price book needs
  | 'send_estimate';       // draft includes price-book ranges

export interface Decision {
  route: Route;
  reply: string | null;     // always a draft for human approval; null when nothing should be sent
  services: (ServiceCode | 'other')[];
  zip: string | null;
  missing: InfoKey[];
  flags: string[];          // every guardrail that fired, for the review queue and the evals
  staff_note: string;
}
