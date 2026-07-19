import type { VerticalConfig } from '../vertical-schema';

/**
 * Second vertical: US residential moving (the configuration proof). Swapping
 * from equipment rental to moving changes THIS OBJECT, not code: spec
 * taxonomy, benchmarks, red-flag rules, levers, interview outline.
 */
export const movingUs: VerticalConfig = {
  slug: 'moving-us',
  label: 'Residential moving (US)',
  currency: 'USD',
  vatRate: 0,
  taxLabel: 'Sales tax n/a (labor)',
  demoRequestSummary:
    'Two-bedroom apartment move, Rock Hill SC to Charlotte NC, standard service, three weeks out',
  specFields: [
    {
      id: 'origin_address',
      label: 'Origin address',
      type: 'text',
      required: true,
    },
    {
      id: 'destination_address',
      label: 'Destination address',
      type: 'text',
      required: true,
    },
    {
      id: 'distance_miles',
      label: 'Distance',
      type: 'number',
      unit: 'miles',
      required: false,
    },
    {
      id: 'home_size',
      label: 'Home size',
      type: 'select',
      required: true,
      options: ['studio', '1_bedroom', '2_bedroom', '3_bedroom', '4_plus_bedroom'],
    },
    {
      id: 'large_items',
      label: 'Large items',
      type: 'multiselect',
      required: false,
      options: ['piano', 'safe', 'appliances', 'treadmill', 'furniture_disassembly_needed'],
    },
    {
      id: 'origin_stairs',
      label: 'Stairs at origin',
      type: 'select',
      required: true,
      options: ['none_or_elevator', 'one_flight', 'two_flights', 'three_plus_flights'],
    },
    {
      id: 'destination_stairs',
      label: 'Stairs at destination',
      type: 'select',
      required: true,
      options: ['none_or_elevator', 'one_flight', 'two_flights', 'three_plus_flights'],
    },
    {
      id: 'long_carry',
      label: 'Long carry over 75 ft',
      type: 'boolean',
      required: true,
    },
    {
      id: 'packing_service',
      label: 'Packing service',
      type: 'select',
      required: true,
      options: ['none_self_packed', 'partial_fragile_only', 'full_packing'],
    },
    {
      id: 'move_date',
      label: 'Move date',
      type: 'date',
      required: true,
    },
    {
      id: 'move_window',
      label: 'Arrival window',
      type: 'time_window',
      required: false,
    },
    {
      id: 'date_flexibility_days',
      label: 'Date flexibility',
      type: 'number',
      unit: 'days',
      required: false,
      hint: 'Only if you can shift the move date',
    },
    {
      id: 'valuation_preference',
      label: 'Valuation / insurance',
      type: 'select',
      required: true,
      options: ['released_value_free', 'full_value_protection', 'undecided'],
    },
    {
      id: 'deposit_tolerance',
      label: 'Deposit tolerance',
      type: 'select',
      required: true,
      options: ['none', 'up_to_200', 'up_to_500', 'any'],
    },
    {
      id: 'budget_net',
      label: 'Budget',
      type: 'number',
      unit: 'USD',
      required: false,
      hint: 'Only stored if you provide one. Only revealed if you authorize it.',
    },
    {
      id: 'company',
      label: 'Household / company name',
      type: 'text',
      required: true,
    },
    {
      id: 'contact',
      label: 'Contact person',
      type: 'text',
      required: true,
    },
  ],
  levers: [
    {
      id: 'may_reveal_budget',
      label: 'Reveal budget',
      description: 'The agent may state your budget when it helps close a better rate.',
      defaultAuthorized: false,
    },
    {
      id: 'may_adjust_delivery_window',
      label: 'Adjust arrival window',
      description: 'The agent may accept a wider arrival window if compensated.',
      defaultAuthorized: false,
    },
    {
      id: 'may_extend_rental_period',
      label: 'Shift the move date',
      description: 'The agent may shift the move date within your stated flexibility.',
      defaultAuthorized: false,
    },
    {
      id: 'may_accept_equivalent_equipment',
      label: 'Accept crew/truck substitution',
      description: 'The agent may accept an equivalent crew or truck configuration.',
      defaultAuthorized: false,
    },
    {
      id: 'may_offer_repeat_business',
      label: 'Offer referrals',
      description: 'The agent may mention realistic referral potential.',
      defaultAuthorized: false,
    },
    {
      id: 'may_accept_pickup_instead_of_delivery',
      label: 'Accept depot drop-off',
      description: 'The agent may accept container/depot options instead of door-to-door.',
      defaultAuthorized: false,
    },
    {
      id: 'may_commit_immediately',
      label: 'Commit immediately',
      description: 'The agent may book up to your maximum commitment.',
      defaultAuthorized: false,
    },
  ],
  quoteCategories: [
    { id: 'rental', label: 'Base labor & truck', typicallyMandatory: true },
    { id: 'delivery', label: 'Travel / mileage fee', typicallyMandatory: true },
    { id: 'pickup', label: 'Stairs / long-carry fees', typicallyMandatory: false },
    { id: 'insurance', label: 'Valuation coverage', typicallyMandatory: true },
    { id: 'accessory', label: 'Packing materials', typicallyMandatory: false },
    { id: 'surcharge', label: 'Surcharges', typicallyMandatory: false },
    { id: 'discount', label: 'Discounts', typicallyMandatory: false },
    { id: 'deposit', label: 'Deposit (refundable)', typicallyMandatory: false },
    { id: 'cleaning', label: 'Cleaning (conditional)', typicallyMandatory: false },
    { id: 'fuel', label: 'Fuel surcharge (conditional)', typicallyMandatory: false },
    { id: 'late_fee', label: 'Overtime (conditional)', typicallyMandatory: false },
    { id: 'damage_waiver', label: 'Damage terms (conditional)', typicallyMandatory: false },
    { id: 'overtime', label: 'Extra hours (conditional)', typicallyMandatory: false },
    { id: 'other', label: 'Other', typicallyMandatory: false },
  ],
  benchmark: {
    unit: 'USD per local/short-distance 2BR move, US Southeast',
    // No verified public median fetched for this configuration proof; the
    // red-flag rule stays inactive rather than resting on an invented number.
    medianDailyRateNet: null,
    references: [
      {
        source: 'FMCSA Protect Your Move (consumer guidance)',
        url: 'https://www.fmcsa.dot.gov/protect-your-move',
        item: 'Federal guidance: gather multiple estimates; sight-unseen phone quotes are unreliable',
        daily_rate_net: null,
        notes: 'Regulatory consumer-protection source for moving; used for red-flag doctrine, not price levels',
        retrieved_at: '2026-07-19T00:30:00Z',
      },
      {
        source: 'moveBuddha moving cost data',
        url: 'https://www.movebuddha.com/moving-cost-calculator/',
        item: 'Public moving cost calculator / market data',
        daily_rate_net: null,
        notes: 'Public market-spread reference named by the challenge organizers; consult for current spreads',
        retrieved_at: '2026-07-19T00:30:00Z',
      },
    ],
  },
  redFlagRules: {
    // Industry guidance treats quotes far below the competition as a warning
    // sign; the same 70%-of-median rule applies once a benchmark median exists.
    belowBenchmarkMedianFraction: 0.7,
  },
  interviewOutline: [
    'Where are you moving from, and where to?',
    'How large is the home, and any pianos, safes, or oversized items?',
    'Stairs or elevator at each end? Any long carry from door to truck?',
    'Do you pack yourself, or should the crew pack (everything or fragile only)?',
    'What is the move date, and how flexible is it?',
    'Valuation: free released-value coverage or full value protection?',
    'Deposit tolerance?',
    'Name and contact for the estimate?',
    'Do you want to state a budget? It stays private unless you authorize revealing it.',
  ],
  supplierSearchTemplate: 'moving company {region} residential movers',
};
