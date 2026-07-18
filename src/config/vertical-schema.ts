import { z } from 'zod';

/**
 * Vertical parameters are configuration, not code. Everything a vertical
 * changes — spec taxonomy, benchmarks, red-flag rules, levers, interview
 * outline — lives in one JSON-serializable object validated by this schema.
 */

export const SpecFieldSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'boolean', 'date', 'time_window', 'select', 'multiselect']),
  unit: z.string().optional(),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
  hint: z.string().optional(),
});

export const LeverDefSchema = z.object({
  id: z.enum([
    'may_reveal_budget',
    'may_adjust_delivery_window',
    'may_extend_rental_period',
    'may_accept_equivalent_equipment',
    'may_offer_repeat_business',
    'may_accept_pickup_instead_of_delivery',
    'may_commit_immediately',
  ]),
  label: z.string(),
  description: z.string(),
  defaultAuthorized: z.boolean(),
});

export const BenchmarkReferenceSchema = z.object({
  source: z.string(),
  url: z.string().url(),
  item: z.string(),
  daily_rate_net: z.number().nullable(),
  notes: z.string().optional(),
  retrieved_at: z.string(),
});

export const QuoteCategorySchema = z.object({
  id: z.enum([
    'rental',
    'delivery',
    'pickup',
    'insurance',
    'accessory',
    'surcharge',
    'discount',
    'deposit',
    'cleaning',
    'fuel',
    'late_fee',
    'damage_waiver',
    'overtime',
    'other',
  ]),
  label: z.string(),
  typicallyMandatory: z.boolean(),
});

export const VerticalConfigSchema = z.object({
  slug: z.string(),
  label: z.string(),
  currency: z.enum(['EUR', 'USD']),
  vatRate: z.number(),
  taxLabel: z.string(),
  demoRequestSummary: z.string(),
  specFields: z.array(SpecFieldSchema),
  levers: z.array(LeverDefSchema),
  quoteCategories: z.array(QuoteCategorySchema),
  benchmark: z.object({
    unit: z.string(),
    medianDailyRateNet: z.number().nullable(),
    references: z.array(BenchmarkReferenceSchema),
  }),
  redFlagRules: z.object({
    // normalized total below this fraction of benchmark median is flagged
    belowBenchmarkMedianFraction: z.number(),
  }),
  interviewOutline: z.array(z.string()),
  supplierSearchTemplate: z.string(),
});

export type VerticalConfig = z.infer<typeof VerticalConfigSchema>;
export type SpecField = z.infer<typeof SpecFieldSchema>;
export type LeverDef = z.infer<typeof LeverDefSchema>;
