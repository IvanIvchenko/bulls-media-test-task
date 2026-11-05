import type { Migration } from '../typedef.js';
import { initialSchema } from './001-initial-schema.migration.js';
import { defectClaimsNeedReview } from './002-defect-claims-need-review.migration.js';

/** In order. Add new migrations to the end; never edit one that has shipped. */
export const MIGRATIONS: readonly Migration[] = [initialSchema, defectClaimsNeedReview];
