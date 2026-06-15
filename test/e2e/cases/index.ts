import type { E2ECase } from './types.ts';
import { provisionCase } from './provision.case.ts';

export const ALL_CASES: readonly E2ECase[] = [
  provisionCase,
  // 后续 task 追加：releaseNotesCase, noFallbackCase, coldStartCase, ...
];
