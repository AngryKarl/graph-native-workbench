import { gtr, ltr, satisfies, valid, validRange } from 'semver';

export type EngineCompatibilityCode =
  | 'compatible'
  | 'requires-newer-engine'
  | 'requires-older-engine'
  | 'unsupported-engine-range';

export interface EngineCompatibilityReport {
  readonly compatible: boolean;
  readonly code: EngineCompatibilityCode;
  readonly engineVersion: string;
  readonly requiredRange: string;
  readonly message: string;
}

export function evaluateEngineCompatibility(
  requiredRange: string,
  engineVersion: string,
): EngineCompatibilityReport {
  if (!valid(engineVersion) || !validRange(requiredRange)) {
    return {
      compatible: false,
      code: 'unsupported-engine-range',
      engineVersion,
      requiredRange,
      message: `Graphwork ${engineVersion} cannot evaluate engine range ${requiredRange}.`,
    };
  }
  if (satisfies(engineVersion, requiredRange)) {
    return {
      compatible: true,
      code: 'compatible',
      engineVersion,
      requiredRange,
      message: `Compatible with Graphwork ${engineVersion}.`,
    };
  }
  const code: EngineCompatibilityCode = ltr(engineVersion, requiredRange)
    ? 'requires-newer-engine'
    : gtr(engineVersion, requiredRange)
      ? 'requires-older-engine'
      : 'unsupported-engine-range';
  const action = code === 'requires-newer-engine'
    ? 'Upgrade Graphwork before installing this Pack.'
    : code === 'requires-older-engine'
      ? 'Use an older compatible Graphwork release or upgrade the Pack.'
      : 'Use a Pack release whose engine range includes this Graphwork version.';
  return {
    compatible: false,
    code,
    engineVersion,
    requiredRange,
    message: `Pack requires Graphwork ${requiredRange}; current engine is ${engineVersion}. ${action}`,
  };
}
