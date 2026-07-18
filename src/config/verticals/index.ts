import { VerticalConfigSchema, type VerticalConfig } from '../vertical-schema';
import { equipmentRentalStuttgart } from './equipment-rental-stuttgart';

const raw: VerticalConfig[] = [equipmentRentalStuttgart];

/** All verticals, validated at module load. Adding a vertical = adding a config object. */
export const verticals: VerticalConfig[] = raw.map((v) => VerticalConfigSchema.parse(v));

export function getVertical(slug: string): VerticalConfig {
  const v = verticals.find((x) => x.slug === slug);
  if (!v) throw new Error(`Unknown vertical: ${slug}`);
  return v;
}

export const DEFAULT_VERTICAL_SLUG = 'equipment-rental-stuttgart';
