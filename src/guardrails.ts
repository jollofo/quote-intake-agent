// Deterministic policy layer. The model proposes a reading of the inquiry and a
// draft; this file decides what happens. It runs with no network access, so the
// unit tests cover it exhaustively and the evals measure what it catches.
import { BUSINESS, DETAILS_TOKEN, PRICE_BOOK, SAFETY_REPLY, SERVICE_AREA_ZIPS, type InfoKey, type ServiceCode } from './business.ts';
import type { Decision, Triage } from './schema.ts';

// Hazards where waiting for a model to notice is not acceptable. Matching any
// of these forces the safety route even if the model said "no concern".
const SAFETY_PATTERNS: [RegExp, string][] = [
  [/\b(smell(s|ing)? (of |like )?gas|gas (smell|leak|odor|odour)|rotten eggs?)\b/i, 'gas odor'],
  [/\b(carbon monoxide|co (alarm|detector)|co2? detector (is )?(going off|beeping))\b/i, 'carbon monoxide'],
  [/\b(spark(s|ing)?|arcing|smok(e|ing) from|burning (smell|plastic)|melted (outlet|wire|plug))\b/i, 'electrical fire risk'],
  [/\b(water|flood(ing|ed)?) (near|around|on|into) (the )?(panel|breaker|outlet|electrical)\b/i, 'water near electrical'],
  [/\b(panel|breaker( box)?|outlet|switch|wires?|plug)\b[^.]{0,40}\b(hot|warm) to the touch|\b(panel|breaker( box)?)\b[^.]{0,40}\b(buzz(es|ing)?|humm?ing|crackl(es|ing))\b/i, 'overheating electrical'],
  [/\b(water|puddle|leak(ing)?|drip(ping)?)\b[^.]{0,60}\b(under|near|next to|around|on|into|behind)\b[^.]{0,20}\b(electrical )?(panel|breaker( box)?|outlets?)\b/i, 'water near electrical'],
  [/\b(olor a gas|huele a gas|fuga de gas|chispas|huele a quemado|quemad[oa]s?|humo)\b/i, 'gas, sparks or burning (es)'],
];

const URGENT_PATTERNS = /\b(burst|bursting|flooding|water (is )?(pouring|everywhere|gushing)|sewage (backing|backup|coming up)|no heat\b.*\b(baby|infant|elderly|freezing|below zero|\d+ ?degrees)|no (hot )?water at all)\b/i;

// Money and commitments are the two things a reply must never invent.
const MONEY = /(\$\s?\d|\d[\d,.]*\s?(dollars|usd|bucks)\b|\b\d+\s?%\s?(off|discount))/i;
const COMMITMENT = /\b(guarantee[ds]?|promise[ds]?|we('ll| will) be there (today|tonight|tomorrow|in \d+)|(today|tomorrow) at \d{1,2}(:\d\d)?\s?(am|pm)?|free of charge|no charge|waive)\b/i;
const MANIPULATION = /\b(ignore (all |any |your )?(previous |prior )?instructions|system prompt|you are now|act as|developer mode|pretend (to be|you)|give me (a |an )?(\d+ ?% )?(discount|free)|\d+ ?% (off|discount)|(discount|price|that) in writing|ignore (your |the |all |any )?(\w+ )?(rules|instructions)|(print|reveal|show|output) (me )?(your |the )?(full |internal )?(instructions|prompt)|(do it|for) free\b|knock (a little|something|some) off)\b/i;

// Details the price book needs must have some evidence in the customer's text before
// the model's claim that they were "provided" is believed. Unverified claims are
// dropped, which only ever makes the agent ask again, never skip a question.
const EVIDENCE: Partial<Record<InfoKey, RegExp>> = {
  equipment_age: /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty)[- ]?(years?|yrs?)\b|\b(brand new|new last year)\b|\baños\b/i,
  photos: /\b(photos?|pictures?|pics?|images?|attached|fotos?)\b/i,
  access_details: /\b(under|behind|inside|ceiling|wall|floor|cabinet|basement|attic|crawl ?space|trap|pipe under)\b/i,
  fixture_count: /\b(\d+|one|two|three|four|five|six|single|a|an|un|una|dos|tres|cuatro)\s+(new\s+|nuev[oa]s?\s+)?(\w+\s+)?(faucets?|fixtures?|outlets?|switch(es)?|fans?|lights?|toilets?|sinks?|devices?|l[aá]mparas?|inodoros?|enchufes?|grifos?|lavamanos|ventiladores?)\b/i,
};

const digits = (s: string) => s.replace(/\D/g, '');

// A field the model extracted must be visible in what the customer wrote.
function grounded(value: string | null, inquiry: string, kind: 'zip' | 'phone' | 'email'): boolean {
  if (!value) return true;
  if (kind === 'email') return inquiry.toLowerCase().includes(value.toLowerCase());
  const d = digits(value);
  if (kind === 'zip') return d.length === 5 && new RegExp(`\\b${d}\\b`).test(inquiry);
  return d.length >= 10 && digits(inquiry).includes(d.slice(-10));
}

export function estimateLines(codes: ServiceCode[]): string {
  return codes.map(c => {
    const p = PRICE_BOOK[c];
    return `- ${p.label}: $${p.low.toLocaleString('en-US')}-$${p.high.toLocaleString('en-US')} (${p.unit})`;
  }).join('\n');
}

const INFO_ASK: Record<InfoKey, string> = {
  address_or_zip: 'the service address (or at least the ZIP code)',
  phone_or_email: 'the best phone number or email to reach you',
  equipment_age: 'roughly how old the equipment is, and the brand if you know it',
  photos: 'a couple of photos of the equipment and the area around it',
  access_details: 'where the leak is and whether it is behind a wall, ceiling or under a floor',
  fixture_count: 'how many fixtures or devices you need done',
  preferred_time: 'a few times that work for a visit',
};

// The block code writes into the reply: price-book ranges, or the questions the price book needs answered.
function detailsBlock(route: 'ask_for_info' | 'send_estimate', codes: ServiceCode[], missing: InfoKey[]): string {
  if (route === 'ask_for_info') return `To get you an accurate quote, could you send:\n${missing.map(k => `- ${INFO_ASK[k]}`).join('\n')}`;
  return `Our published pricing for this work:\n${estimateLines(codes)}\n\nA technician confirms the final price before any work starts.`;
}

function templateReply(route: Decision['route'], codes: ServiceCode[], missing: InfoKey[], name: string | null): string {
  const hi = `Hi${name ? ` ${name.split(' ')[0]}` : ''},\n\nThanks for reaching out to ${BUSINESS.name}.`;
  const sign = `\n\n${BUSINESS.name} · ${BUSINESS.phone} · ${BUSINESS.hours}`;
  if (route === 'decline_out_of_area') return `${hi} Unfortunately that address is outside the area our crews cover, so we're not able to take this job. We're sorry we can't help this time.${sign}`;
  if (route === 'decline_out_of_scope') return `${hi} That isn't work we do. We handle heating and cooling, plumbing and electrical, so we'd recommend a contractor who specializes in it.${sign}`;
  if (route === 'ask_for_info' || route === 'send_estimate') return `${hi}\n\n${detailsBlock(route, codes, missing)}${sign}`;
  return `${hi}${sign}`;
}

export function decide(inquiry: string, t: Triage): Decision {
  const flags: string[] = [];
  const known = [...new Set(t.services.map(s => s.code))];
  const codes = known.filter((c): c is ServiceCode => c !== 'other');
  const base = { services: known, staff_note: t.staff_note };

  // Ground every extracted contact field in the original text.
  let zip = t.zip;
  if (!grounded(zip, inquiry, 'zip')) { flags.push('ungrounded_zip'); zip = null; }
  const contact = { ...t.contact };
  if (!grounded(contact.phone, inquiry, 'phone')) { flags.push('ungrounded_phone'); contact.phone = null; }
  if (!grounded(contact.email, inquiry, 'email')) { flags.push('ungrounded_email'); contact.email = null; }

  if (t.is_spam) return { ...base, route: 'discard_spam', reply: null, zip, missing: [], flags: [...flags, 'spam'] };

  const hazard = SAFETY_PATTERNS.find(([re]) => re.test(inquiry));
  if (hazard || t.safety_concern) {
    if (hazard && !t.safety_concern) flags.push('safety_override');
    return { ...base, route: 'escalate_safety', reply: SAFETY_REPLY, zip, missing: [], flags: [...flags, `safety:${hazard?.[1] ?? t.safety_reason}`] };
  }

  if (t.manipulation_attempt || MANIPULATION.test(inquiry)) {
    if (!t.manipulation_attempt) flags.push('manipulation_override');
    return { ...base, route: 'escalate_human', reply: null, zip, missing: [], flags: [...flags, 'manipulation'] };
  }

  if (t.urgency === 'emergency' || URGENT_PATTERNS.test(inquiry)) {
    if (t.urgency !== 'emergency') flags.push('urgency_override');
    return { ...base, route: 'escalate_urgent', reply: null, zip, missing: [], flags };
  }

  if (zip && !SERVICE_AREA_ZIPS.has(zip)) {
    return { ...base, route: 'decline_out_of_area', reply: templateReply('decline_out_of_area', [], [], t.contact.name), zip, missing: [], flags };
  }

  if (known.length === 0 || t.confidence === 'low') {
    return { ...base, route: 'escalate_human', reply: null, zip, missing: [], flags: [...flags, known.length ? 'low_confidence' : 'no_service_identified'] };
  }
  if (codes.length === 0) {
    return { ...base, route: 'decline_out_of_scope', reply: templateReply('decline_out_of_scope', [], [], t.contact.name), zip, missing: [], flags };
  }
  if (codes.length < known.length) flags.push('partial_scope');

  // Missing information comes from the price book, not from the model's opinion.
  const needed = [...new Set(codes.flatMap(c => PRICE_BOOK[c].needs))];
  const provided = new Set<InfoKey>(t.provided);
  for (const key of needed) {
    const re = EVIDENCE[key];
    if (re && provided.has(key) && !re.test(inquiry)) { provided.delete(key); flags.push(`ungrounded_${key}`); }
  }
  if (zip) provided.add('address_or_zip'); else provided.delete('address_or_zip');
  if (contact.phone || contact.email) provided.add('phone_or_email'); else provided.delete('phone_or_email');
  const missing = needed.filter(k => !provided.has(k));
  const route = missing.length ? 'ask_for_info' : 'send_estimate';

  // The model's draft is used only if it passes every check; otherwise a template.
  const draft = t.reply_draft;
  const prose = draft.replaceAll(DETAILS_TOKEN, '');
  if (MONEY.test(prose)) flags.push('draft_invented_price');
  if (COMMITMENT.test(prose)) flags.push('draft_made_commitment');
  if (draft.split(DETAILS_TOKEN).length !== 2) flags.push('draft_missing_placeholder');
  let reply: string;
  if (flags.some(f => f.startsWith('draft_'))) {
    reply = templateReply(route, codes, missing, t.contact.name);
    if (t.language !== 'en') flags.push('needs_translation');
  } else {
    reply = draft.replace(DETAILS_TOKEN, detailsBlock(route, codes, missing));
    if (t.language !== 'en') flags.push('details_in_english');
  }

  return { ...base, route, reply, zip, missing, flags };
}
