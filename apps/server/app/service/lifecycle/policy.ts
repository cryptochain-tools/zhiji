/**
 * Lifecycle validation is part of the public management contract so every
 * caller interprets the wire format and fixed privacy ceilings identically.
 */
export {
  DATA_LIFECYCLE_CAPS,
  DATA_LIFECYCLE_FIELDS,
  DEFAULT_DATA_LIFECYCLE_POLICY,
  effectiveDataLifecyclePolicy,
  legacyDataLifecyclePolicy,
  parseDataLifecyclePolicy,
} from '@zhiji/contracts'
export type { DataLifecycleField, DataLifecyclePolicy } from '@zhiji/contracts'
