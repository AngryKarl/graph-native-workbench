import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const siteRoot = 'https://angrykarl.github.io/graph-workbench/';
const pages = [
  { path: 'docs/pages/index.html', canonical: siteRoot },
  { path: 'docs/pages/what-is-graph-workbench/index.html', canonical: `${siteRoot}what-is-graph-workbench/` },
  { path: 'docs/pages/execution-graph-vs-context-graph/index.html', canonical: `${siteRoot}execution-graph-vs-context-graph/` },
  { path: 'docs/pages/cross-run-agent-memory/index.html', canonical: `${siteRoot}cross-run-agent-memory/` },
  { path: 'docs/pages/industry-packs/index.html', canonical: `${siteRoot}industry-packs/` },
] as const;

function localTarget(href: string): string | undefined {
  const prefix = '/graph-workbench/';
  if (!href.startsWith(prefix)) return undefined;
  const relative = href.slice(prefix.length);
  if (relative.startsWith('assets/')) return resolve(root, 'docs', relative);
  if (relative === '') return resolve(root, 'docs/pages/index.html');
  if (relative.endsWith('/')) return resolve(root, 'docs/pages', relative, 'index.html');
  return resolve(root, 'docs/pages', relative);
}

describe('GitHub Pages discovery surface', () => {
  it.each(pages)('$path exposes unique crawl and citation metadata', async ({ path, canonical }) => {
    const html = await readFile(resolve(root, path), 'utf8');
    expect(html).toContain(`<link rel="canonical" href="${canonical}">`);
    expect(html).toMatch(/<meta name="description" content="[^"]+">/);
    expect(html).toMatch(/<h1[\s>]/);

    const jsonLd = html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/)?.[1];
    expect(jsonLd).toBeTruthy();
    expect(() => JSON.parse(jsonLd ?? '')).not.toThrow();
  });

  it('keeps every project-local page and asset link resolvable from the published bundle', async () => {
    for (const { path } of pages) {
      const html = await readFile(resolve(root, path), 'utf8');
      const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1] ?? '');
      const targets = hrefs.map(localTarget).filter((target): target is string => Boolean(target));
      await Promise.all(targets.map((target) => access(target)));
    }
  });

  it('lists every canonical page in the sitemap and LLM index', async () => {
    const sitemap = await readFile(resolve(root, 'docs/pages/sitemap.xml'), 'utf8');
    const llms = await readFile(resolve(root, 'docs/pages/llms.txt'), 'utf8');
    for (const { canonical } of pages) expect(sitemap).toContain(`<loc>${canonical}</loc>`);
    for (const { canonical } of pages.slice(1)) expect(llms).toContain(`](${canonical})`);
  });

  it('publishes the Google Search Console ownership proof at the site root', async () => {
    const verification = await readFile(
      resolve(root, 'docs/pages/googlebc466a694798aa5c.html'),
      'utf8',
    );
    expect(verification.trim()).toBe('google-site-verification: googlebc466a694798aa5c.html');
  });
});
