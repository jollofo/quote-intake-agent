// The business this agent works for. Lakeview Trades Co. is fictional; the
// price book, service area and policies are the operator-owned facts the
// model is never allowed to invent. Everything customer-facing that involves
// money, scheduling or scope is looked up here by code, not generated.

export const BUSINESS = {
  name: 'Lakeview Trades Co.',
  phone: '(585) 555-0142',
  emergencyLine: '(585) 555-0199',
  hours: 'Mon-Fri 7am-6pm, Sat 8am-2pm',
} as const;

// Rochester, NY area ZIP codes the crews cover.
export const SERVICE_AREA_ZIPS = new Set([
  '14604', '14605', '14606', '14607', '14608', '14609', '14610', '14611', '14612', '14613',
  '14614', '14615', '14616', '14617', '14618', '14619', '14620', '14621', '14622', '14623',
  '14624', '14625', '14626', '14534', '14526', '14580',
]);

export type InfoKey = 'address_or_zip' | 'phone_or_email' | 'equipment_age' | 'photos' | 'access_details' | 'fixture_count' | 'preferred_time';

export type ServiceCode =
  | 'hvac_repair' | 'hvac_tuneup' | 'furnace_replace' | 'ac_install'
  | 'water_heater_repair' | 'water_heater_replace' | 'drain_clog' | 'leak_repair' | 'fixture_install'
  | 'panel_upgrade' | 'outlet_switch' | 'ev_charger';

export interface PriceBookEntry {
  label: string;
  low: number;
  high: number;
  unit: string;
  // Information a dispatcher needs before the range is meaningful.
  needs: InfoKey[];
}

// Ranges are published, all-in starting prices. The agent may quote only these.
export const PRICE_BOOK: Record<ServiceCode, PriceBookEntry> = {
  hvac_repair: { label: 'heating/cooling repair visit', low: 129, high: 189, unit: 'diagnostic visit, applied to the repair', needs: ['address_or_zip', 'phone_or_email', 'equipment_age'] },
  hvac_tuneup: { label: 'furnace or AC tune-up', low: 119, high: 149, unit: 'per system', needs: ['address_or_zip', 'phone_or_email'] },
  furnace_replace: { label: 'furnace replacement', low: 4200, high: 7800, unit: 'installed, after an in-home estimate', needs: ['address_or_zip', 'phone_or_email', 'equipment_age', 'photos'] },
  ac_install: { label: 'central AC installation', low: 4800, high: 8900, unit: 'installed, after an in-home estimate', needs: ['address_or_zip', 'phone_or_email', 'photos'] },
  water_heater_repair: { label: 'water heater repair visit', low: 129, high: 189, unit: 'diagnostic visit, applied to the repair', needs: ['address_or_zip', 'phone_or_email', 'equipment_age'] },
  water_heater_replace: { label: 'water heater replacement', low: 1650, high: 3200, unit: 'installed (tank); tankless quoted on site', needs: ['address_or_zip', 'phone_or_email', 'equipment_age', 'photos'] },
  drain_clog: { label: 'drain clearing', low: 149, high: 295, unit: 'per drain line', needs: ['address_or_zip', 'phone_or_email'] },
  leak_repair: { label: 'leak repair visit', low: 149, high: 325, unit: 'typical repair', needs: ['address_or_zip', 'phone_or_email', 'access_details'] },
  fixture_install: { label: 'fixture installation', low: 175, high: 450, unit: 'per fixture, customer-supplied', needs: ['address_or_zip', 'phone_or_email', 'fixture_count'] },
  panel_upgrade: { label: 'electrical panel upgrade', low: 2400, high: 4500, unit: 'installed, permit included', needs: ['address_or_zip', 'phone_or_email', 'photos'] },
  outlet_switch: { label: 'outlet or switch work', low: 145, high: 260, unit: 'first device, $65 each additional', needs: ['address_or_zip', 'phone_or_email', 'fixture_count'] },
  ev_charger: { label: 'Level 2 EV charger installation', low: 950, high: 2200, unit: 'installed, panel capacity permitting', needs: ['address_or_zip', 'phone_or_email', 'photos'] },
};

export const SERVICE_CODES = Object.keys(PRICE_BOOK) as ServiceCode[];

// Written by the operator, not the model. Used verbatim when safety overrides fire.
export const SAFETY_REPLY = `If you smell gas, see sparks or smoke, or a carbon monoxide alarm is sounding, leave the building now and call 911 or your utility's emergency line from outside. Don't use switches, outlets or open flames on the way out. Once everyone is safe, call our emergency line at ${BUSINESS.emergencyLine} and we'll dispatch a technician.`;

// The model writes this placeholder where pricing or the list of questions goes;
// code fills it, so the model never states a price or decides what is missing.
export const DETAILS_TOKEN = '{{DETAILS}}';
