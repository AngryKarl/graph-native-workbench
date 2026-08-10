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
      message: `Graph Workbench ${engineVersion} cannot evaluate engine range ${requiredRange}.`,
    };
  }
  if (satisfies(engineVersion, requiredRange)) {
    return {
      compatible: true,
      code: 'compatible',
      engineVersion,
      requiredRange,
      message: `Compatible with Graph Workbench ${engineVersion}.`,
    };
  }
  const code: EngineCompatibilityCode = ltr(engineVersion, requiredRange)
    ? 'requires-newer-engine'
    : gtr(engineVersion, requiredRange)
      ? 'requires-older-engine'
      : 'unsupported-engine-range';
  const action = code === 'requires-newer-engine'
    ? 'Upgrade Graph Workbench before installing this Pack.'
    : code === 'requires-older-engine'
      ? 'Use an older compatible Graph Workbench release or upgrade the Pack.'
      : 'Use a Pack release whose engine range includes this Graph Workbench version.';
  return {
    compatible: false,
    code,
    engineVersion,
    requiredRange,
    message: `Pack requires Graph Workbench ${requiredRange}; current engine is ${engineVersion}. ${action}`,
  };
}
