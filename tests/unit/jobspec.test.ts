import { describe, expect, it } from 'vitest';
import { buildConfirmFieldsSchema, buildDraftFieldsSchema, specBriefLines } from '@/core/jobspec';
import { getVertical } from '@/config/verticals';

const vertical = getVertical('equipment-rental-stuttgart');

const completeFields = {
  equipment_category: 'scissor_lift',
  working_height_m: 12,
  power_type: 'electric',
  indoor_outdoor: 'both',
  ground_conditions: 'paved',
  site_access: null,
  delivery_address: 'Baustelle Königstraße 10, Stuttgart',
  delivery_date: '2026-07-27',
  delivery_window: { earliest: null, latest: '07:00' },
  pickup_date: '2026-07-31',
  pickup_window: null,
  duration_business_days: 5,
  accessories: [],
  operator_required: false,
  charging_or_fuel: '230v_available',
  insurance_preference: 'supplier_liability_reduction',
  deposit_tolerance: 'up_to_500',
  budget_net: null,
  company: 'Bau Süd GmbH',
  contact: 'M. Weber',
};

describe('draft schema', () => {
  it('accepts a fully null draft', () => {
    const draft = Object.fromEntries(vertical.specFields.map((f) => [f.id, null]));
    expect(() => buildDraftFieldsSchema(vertical).parse(draft)).not.toThrow();
  });

  it('rejects unknown fields', () => {
    const draft = Object.fromEntries(vertical.specFields.map((f) => [f.id, null]));
    expect(() =>
      buildDraftFieldsSchema(vertical).parse({ ...draft, invented_field: 'x' }),
    ).toThrow();
  });

  it('rejects wrong enum values', () => {
    const draft = Object.fromEntries(vertical.specFields.map((f) => [f.id, null]));
    expect(() =>
      buildDraftFieldsSchema(vertical).parse({ ...draft, power_type: 'nuclear' }),
    ).toThrow();
  });
});

describe('confirm schema', () => {
  it('accepts the complete demo spec', () => {
    expect(() => buildConfirmFieldsSchema(vertical).parse(completeFields)).not.toThrow();
  });

  it('rejects when a required field is null', () => {
    expect(() =>
      buildConfirmFieldsSchema(vertical).parse({ ...completeFields, delivery_address: null }),
    ).toThrow();
  });

  it('accepts null for optional fields only', () => {
    expect(() =>
      buildConfirmFieldsSchema(vertical).parse({ ...completeFields, budget_net: null }),
    ).not.toThrow();
  });
});

describe('specBriefLines', () => {
  it('renders time windows and skips empty fields', () => {
    const lines = specBriefLines(vertical, completeFields);
    expect(lines.join('\n')).toContain('Delivery window: before 07:00');
    expect(lines.join('\n')).not.toContain('Budget');
  });
});
