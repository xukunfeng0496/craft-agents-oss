import type { E2ECase } from './types.ts';
import { provisionCase } from './provision.case.ts';
import { releaseNotesCase } from './release-notes.case.ts';
import { noFallbackCase } from './no-fallback.case.ts';
import { coldStartCase } from './coldstart.case.ts';
import { limitErrorCase } from './limit-error.case.ts';

export const ALL_CASES: readonly E2ECase[] = [
  coldStartCase,
  provisionCase,
  releaseNotesCase,
  noFallbackCase,
  limitErrorCase,
];
