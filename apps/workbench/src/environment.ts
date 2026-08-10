import { access, cp } from 'node:fs/promises';
import { resolve } from 'node:path';

const legacyEnvironmentPrefix = 'GRAPHWORK_';
const currentEnvironmentPrefix = 'GRAPH_WORKBENCH_';

export function applyLegacyWorkbenchEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = console.warn,
): readonly string[] {
  const migrated: string[] = [];
  for (const [legacyName, value] of Object.entries(environment)) {
    if (!legacyName.startsWith(legacyEnvironmentPrefix) || value === undefined) continue;
    const currentName = `${currentEnvironmentPrefix}${legacyName.slice(legacyEnvironmentPrefix.length)}`;
    if (environment[currentName] !== undefined) continue;
    environment[currentName] = value;
    migrated.push(`${legacyName} -> ${currentName}`);
  }
  if (migrated.length > 0) {
    warn(`Using legacy Graphwork environment variables: ${migrated.join(', ')}.`);
  }
  return migrated;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function migrateLegacyWorkbenchDirectory(
  workspace: string,
  inform: (message: string) => void = console.warn,
): Promise<boolean> {
  const legacy = resolve(workspace, '.graphwork');
  const current = resolve(workspace, '.graph-workbench');
  if (await exists(current) || !await exists(legacy)) return false;
  await cp(legacy, current, { recursive: true, errorOnExist: true });
  inform(`Copied legacy workspace data from ${legacy} to ${current}.`);
  return true;
}
