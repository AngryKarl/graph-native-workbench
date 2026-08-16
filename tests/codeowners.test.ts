import { describe, expect, it } from 'vitest';
import {
  isCodeownerLogin,
  matchCodeowners,
  parseCodeowners,
  resolveCodeowners,
  readAuthenticatedIdentity,
  resolveReviewAuthority,
  GitHubClient,
} from '@graph-workbench/connector-github';

const codeowners = `
# Default owners for everything
*                       @acme/platform @alice

# Docs have their own reviewer
/docs/                  @dana

# Billing overrides the catch-all
apps/billing/**         @bob
apps/billing/critical.ts @carol
`;

describe('CODEOWNERS parsing', () => {
  it('ignores comments and blank lines while keeping source line numbers', () => {
    const rules = parseCodeowners(codeowners);
    expect(rules.map((rule) => rule.pattern)).toEqual([
      '*', '/docs/', 'apps/billing/**', 'apps/billing/critical.ts',
    ]);
    expect(rules[1]).toMatchObject({ pattern: '/docs/', owners: ['@dana'], line: 6 });
  });

  it('keeps a pattern that clears ownership', () => {
    expect(parseCodeowners('/vendor/\n')).toEqual([
      { pattern: '/vendor/', owners: [], line: 1 },
    ]);
  });
});

describe('CODEOWNERS precedence', () => {
  it('lets the last matching rule win, which is how GitHub picks reviewers', () => {
    const rules = parseCodeowners(codeowners);
    // Both `*` and `apps/billing/**` match, but the later line decides.
    expect(matchCodeowners(rules, 'apps/billing/invoice.ts').owners).toEqual(['@bob']);
    // And a still-later, more specific line overrides that.
    expect(matchCodeowners(rules, 'apps/billing/critical.ts').owners).toEqual(['@carol']);
  });

  it('does not union the rules that match one path', () => {
    const owners = matchCodeowners(parseCodeowners(codeowners), 'apps/billing/invoice.ts').owners;
    expect(owners).not.toContain('@alice');
  });

  it('falls back to the catch-all for a path nothing else claims', () => {
    expect(matchCodeowners(parseCodeowners(codeowners), 'src/index.ts').owners)
      .toEqual(['@acme/platform', '@alice']);
  });

  it('applies a rooted directory pattern to everything beneath it', () => {
    const rules = parseCodeowners(codeowners);
    expect(matchCodeowners(rules, 'docs/guide/setup.md').owners).toEqual(['@dana']);
    // The leading slash anchors it, so a nested docs directory is not claimed.
    expect(matchCodeowners(rules, 'apps/docs/readme.md').owners).toEqual(['@acme/platform', '@alice']);
  });

  it('matches an unanchored pattern at any depth', () => {
    const rules = parseCodeowners('build.gradle @eve\n');
    expect(matchCodeowners(rules, 'build.gradle').owners).toEqual(['@eve']);
    expect(matchCodeowners(rules, 'services/api/build.gradle').owners).toEqual(['@eve']);
  });

  it('treats **/ as also matching zero directories', () => {
    const rules = parseCodeowners('**/migrations/ @frank\n');
    expect(matchCodeowners(rules, 'migrations/001.sql').owners).toEqual(['@frank']);
    expect(matchCodeowners(rules, 'db/migrations/001.sql').owners).toEqual(['@frank']);
  });

  it('reports a path no rule claims instead of inventing an owner', () => {
    const resolution = resolveCodeowners('/docs/ @dana\n', ['src/main.ts']);
    expect(resolution.owners).toEqual([]);
    expect(resolution.unownedPaths).toEqual(['src/main.ts']);
  });
});

describe('CODEOWNERS resolution across a change', () => {
  it('unions owners across the paths a change touches', () => {
    const resolution = resolveCodeowners(codeowners, [
      'apps/billing/invoice.ts',
      'docs/guide/setup.md',
    ]);
    expect(resolution.owners).toEqual(['@bob', '@dana']);
  });

  it('authorises a login only when it is a resolved owner', () => {
    const resolution = resolveCodeowners(codeowners, ['apps/billing/invoice.ts']);
    expect(isCodeownerLogin(resolution, 'bob').authorised).toBe(true);
    expect(isCodeownerLogin(resolution, '@bob').authorised).toBe(true);
    expect(isCodeownerLogin(resolution, 'BOB').authorised).toBe(true);
    expect(isCodeownerLogin(resolution, 'alice').authorised).toBe(false);
  });

  it('reports team owners rather than treating unverified membership as a match', () => {
    // Team membership cannot be read from CODEOWNERS, so a caller must decide
    // what to do rather than be told the login is authorised.
    const resolution = resolveCodeowners(codeowners, ['src/index.ts']);
    const outcome = isCodeownerLogin(resolution, 'someone');
    expect(outcome.authorised).toBe(false);
    expect(outcome.unresolvedTeams).toEqual(['@acme/platform']);
  });
});

describe('verified GitHub identity and review authority', () => {
  const transport = (responses: ReadonlyArray<{ status: number; body?: unknown }>) => {
    let index = 0;
    const calls: string[] = [];
    const fetch = (async (url: string | URL) => {
      const next = responses[Math.min(index, responses.length - 1)]!;
      index += 1;
      calls.push(String(url));
      return new Response(next.body === undefined ? '' : JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls };
  };
  const client = (fetch: typeof globalThis.fetch) => new GitHubClient({ token: 'ghp_x', fetch });

  it('reports the login the token actually belongs to, not one that was typed', async () => {
    const stub = transport([{ status: 200, body: { login: 'alice', name: 'Alice Ng', type: 'User' } }]);
    expect(await readAuthenticatedIdentity(client(stub.fetch)))
      .toEqual({ login: 'alice', displayName: 'Alice Ng', kind: 'user' });
    expect(stub.calls[0]).toBe('https://api.github.com/user');
  });

  it('fails when GitHub will not identify the token, rather than assuming anonymous', async () => {
    const stub = transport([{ status: 200, body: {} }]);
    await expect(readAuthenticatedIdentity(client(stub.fetch))).rejects.toThrow(/did not identify/);
  });

  it('authorises a login that owns every changed path', async () => {
    const stub = transport([
      { status: 200, body: { content: Buffer.from('* @alice\napps/billing/** @bob\n').toString('base64'), encoding: 'base64' } },
      { status: 200, body: [{ filename: 'apps/billing/invoice.ts' }] },
    ]);

    const authority = await resolveReviewAuthority(client(stub.fetch), {
      repository: 'acme/api', pullNumber: 7, login: 'bob',
    });

    expect(authority).toMatchObject({ resolved: true, loginIsOwner: true, owners: ['@bob'] });
    expect(authority.changedPaths).toEqual(['apps/billing/invoice.ts']);
  });

  it('refuses authority when the change reaches paths the login does not own', async () => {
    const stub = transport([
      { status: 200, body: { content: Buffer.from('* @alice\napps/billing/** @bob\n').toString('base64'), encoding: 'base64' } },
      { status: 200, body: [{ filename: 'apps/billing/invoice.ts' }, { filename: 'src/index.ts' }] },
    ]);

    const authority = await resolveReviewAuthority(client(stub.fetch), {
      repository: 'acme/api', pullNumber: 7, login: 'bob',
    });

    // The union across paths includes @alice, so @bob alone is not enough.
    expect(authority.owners).toEqual(['@alice', '@bob']);
    expect(authority.loginIsOwner).toBe(false);
  });

  it('states that authority is underived when the repository has no CODEOWNERS', async () => {
    const stub = transport([
      { status: 404, body: { message: 'Not Found' } },
      { status: 404, body: { message: 'Not Found' } },
      { status: 404, body: { message: 'Not Found' } },
      { status: 200, body: [{ filename: 'src/index.ts' }] },
    ]);

    const authority = await resolveReviewAuthority(client(stub.fetch), {
      repository: 'acme/api', pullNumber: 7, login: 'bob',
    });

    expect(authority.resolved).toBe(false);
    expect(authority.loginIsOwner).toBe(false);
    expect(authority.reason).toMatch(/does not declare CODEOWNERS/);
  });

  it('explains a team-owned change instead of silently denying it', async () => {
    const stub = transport([
      { status: 200, body: { content: Buffer.from('* @acme/platform\n').toString('base64'), encoding: 'base64' } },
      { status: 200, body: [{ filename: 'src/index.ts' }] },
    ]);

    const authority = await resolveReviewAuthority(client(stub.fetch), {
      repository: 'acme/api', pullNumber: 7, login: 'bob',
    });

    expect(authority.loginIsOwner).toBe(false);
    expect(authority.unresolvedTeams).toEqual(['@acme/platform']);
    expect(authority.reason).toMatch(/membership CODEOWNERS does not expose/);
  });
});
