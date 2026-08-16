/**
 * CODEOWNERS parsing and matching.
 *
 * GitHub resolves a single path by the *last* matching rule, not the first and
 * not the union — a later, more specific line is meant to override an earlier
 * catch-all. Owners are unioned only across the several paths a change touches.
 * Getting this backwards would hand approval rights to people GitHub would not
 * ask, so both halves are modelled explicitly.
 */

export interface CodeownersRule {
  readonly pattern: string;
  readonly owners: readonly string[];
  /** 1-based line in the source file, for explaining a match. */
  readonly line: number;
}

export interface CodeownersMatch {
  readonly path: string;
  readonly owners: readonly string[];
  readonly rule?: CodeownersRule;
}

/**
 * Parses CODEOWNERS content. Unowned patterns (a pattern with no owners) are
 * kept: GitHub treats them as clearing ownership for those paths.
 */
export function parseCodeowners(content: string): readonly CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  content.split(/\r?\n/).forEach((raw, index) => {
    const withoutComment = raw.split('#', 1)[0] ?? '';
    const trimmed = withoutComment.trim();
    if (!trimmed) return;
    const [pattern, ...owners] = trimmed.split(/\s+/);
    if (!pattern) return;
    rules.push({ pattern, owners, line: index + 1 });
  });
  return rules;
}

function normalise(path: string): string {
  return path.replace(/^\.?\//, '');
}

/**
 * Translates a CODEOWNERS pattern into a regular expression.
 *
 * The supported subset is the one that appears in practice: `*` within a path
 * segment, `**` across segments, a leading `/` to anchor at the repository
 * root, and a trailing `/` to mean "everything under this directory". An
 * unanchored pattern matches at any depth, as gitignore rules do.
 */
function patternToRegExp(pattern: string): RegExp {
  const anchored = pattern.startsWith('/');
  const directoryOnly = pattern.endsWith('/');
  const core = normalise(pattern).replace(/\/$/, '');

  let expression = '';
  let index = 0;
  while (index < core.length) {
    const character = core[index]!;
    if (character === '*' && core[index + 1] === '*') {
      // `**/` may also match nothing, so `**/a` matches `a`.
      if (core[index + 2] === '/') {
        expression += '(?:.*/)?';
        index += 3;
        continue;
      }
      expression += '.*';
      index += 2;
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      index += 1;
      continue;
    }
    if (character === '?') {
      expression += '[^/]';
      index += 1;
      continue;
    }
    expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    index += 1;
  }

  const prefix = anchored ? '^' : '^(?:.*/)?';
  // A directory pattern, and any bare pattern that names a directory, covers
  // everything beneath it.
  const suffix = directoryOnly ? '/.*$' : '(?:/.*)?$';
  return new RegExp(`${prefix}${expression}${suffix}`);
}

/** Owners for one path, applying GitHub's last-match-wins precedence. */
export function matchCodeowners(
  rules: readonly CodeownersRule[],
  path: string,
): CodeownersMatch {
  const candidate = normalise(path);
  let winner: CodeownersRule | undefined;
  for (const rule of rules) {
    if (patternToRegExp(rule.pattern).test(candidate)) winner = rule;
  }
  return {
    path,
    owners: winner?.owners ?? [],
    ...(winner ? { rule: winner } : {}),
  };
}

export interface CodeownersResolution {
  /** Every owner GitHub would ask across the changed paths, lowercased. */
  readonly owners: readonly string[];
  readonly matches: readonly CodeownersMatch[];
  /** Paths no rule claims; a change touching one has no declared owner. */
  readonly unownedPaths: readonly string[];
}

/**
 * Resolves the owners for a set of changed paths: last-match-wins per path,
 * then the union across paths.
 */
export function resolveCodeowners(
  content: string,
  changedPaths: readonly string[],
): CodeownersResolution {
  const rules = parseCodeowners(content);
  const matches = changedPaths.map((path) => matchCodeowners(rules, path));
  const owners = new Set<string>();
  const unownedPaths: string[] = [];
  for (const match of matches) {
    if (match.owners.length === 0) unownedPaths.push(match.path);
    for (const owner of match.owners) owners.add(owner.toLowerCase());
  }
  return { owners: [...owners].sort(), matches, unownedPaths };
}

/**
 * Whether a GitHub login is among the resolved owners.
 *
 * Team owners (`@org/team`) cannot be expanded from CODEOWNERS alone, so they
 * are reported rather than silently treated as a match: claiming a login is
 * authorised when membership was never checked is the failure that matters.
 */
export function isCodeownerLogin(
  resolution: CodeownersResolution,
  login: string,
): { readonly authorised: boolean; readonly unresolvedTeams: readonly string[] } {
  const unresolvedTeams = resolution.owners.filter((owner) => owner.includes('/'));
  return {
    authorised: resolution.owners.includes(normaliseLogin(login)),
    unresolvedTeams,
  };
}

function normaliseLogin(login: string): string {
  return `@${login.replace(/^@/, '')}`.toLowerCase();
}

/**
 * Whether one login can approve the whole change on its own.
 *
 * Owning *some* of the changed paths is not enough. GitHub would still require
 * an owner of every other region to approve, so treating union membership as
 * sufficient would let a partial owner release code nobody responsible had
 * seen. A path with no owner also cannot be covered.
 */
export function loginCoversChange(
  resolution: CodeownersResolution,
  login: string,
): boolean {
  if (resolution.matches.length === 0) return false;
  if (resolution.unownedPaths.length > 0) return false;
  const wanted = normaliseLogin(login);
  return resolution.matches.every((match) =>
    match.owners.some((owner) => owner.toLowerCase() === wanted));
}
