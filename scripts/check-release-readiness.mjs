import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const requiredFiles = [
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CODE_OF_CONDUCT.md',
  'GOVERNANCE.md',
  'SECURITY.md',
  'SUPPORT.md',
  'docs/DEPLOYMENT.md',
  'docs/EXTENSION_POINTS.md',
  'docs/GOOD_FIRST_ISSUES.md',
  'docs/PERFORMANCE.md',
  'docs/RELEASE_PROCESS.md',
  'docs/THREAT_MODEL.md',
  'docs/WHY_TWO_GRAPHS.md',
  'docs/CUSTOMER_SUCCESS_CASE.md',
  'docs/pages/index.html',
  'docs/pages/styles.css',
  'docs/pages/sitemap.xml',
  'docs/pages/llms.txt',
  'docs/pages/what-is-graph-workbench/index.html',
  'docs/pages/execution-graph-vs-context-graph/index.html',
  'docs/pages/cross-run-agent-memory/index.html',
  'docs/pages/industry-packs/index.html',
  'docs/assets/graph-workbench-social-preview.jpg',
  'registry/reference-public.pem',
];
await Promise.all(requiredFiles.map((file) => access(resolve(root, file))));

const manifestPaths = [
  'package.json',
  'apps/distribution/package.json',
  'apps/cli/package.json',
  'apps/workbench/package.json',
  'packages/connector-github/package.json',
  'packages/contracts/package.json',
  'packages/core/package.json',
  'packages/pack-sdk/package.json',
  'packs/cybersecurity-response/package.json',
  'packs/data-mlops/package.json',
  'packs/healthcare-diagnostics/package.json',
  'packs/quantitative-finance/package.json',
  'packs/software-delivery/package.json',
  'packs/architecture/package.json',
  'packs/customer-success/package.json',
  'packs/research/package.json',
  'packs/robotics-fleet/package.json',
];
const manifests = await Promise.all(manifestPaths.map(async (path) => ({
  path,
  value: JSON.parse(await readFile(resolve(root, path), 'utf8')),
})));
for (const { path, value } of manifests) {
  if (value.license !== 'MIT') throw new Error(`${path} must declare the MIT license.`);
  if (value.version !== manifests[0].value.version) {
    throw new Error(`${path} version ${value.version} does not match workspace version ${manifests[0].value.version}.`);
  }
}

const distribution = manifests.find((item) => item.path === 'apps/distribution/package.json')?.value;
if (distribution?.name !== 'graph-workbench') {
  throw new Error('Public package must use the Graph Workbench package name.');
}
if (JSON.stringify(distribution.bin) !== JSON.stringify({ 'graph-workbench': 'dist/graph-workbench.js' })) {
  throw new Error('Public package must expose only the graph-workbench CLI command.');
}
for (const dependency of ['esbuild', 'pg', 'pg-boss']) {
  if (!distribution?.dependencies?.[dependency]) {
    throw new Error(`Public graph-workbench package is missing runtime dependency "${dependency}".`);
  }
}
if (!distribution.repository?.url || !distribution.homepage || !distribution.bugs?.url) {
  throw new Error('Public package repository, homepage and issue metadata are required.');
}
const repositoryUrl = 'https://github.com/AngryKarl/graph-workbench';
if (
  distribution.repository.url !== `git+${repositoryUrl}.git`
  || distribution.homepage !== `${repositoryUrl}#readme`
  || distribution.bugs.url !== `${repositoryUrl}/issues`
) {
  throw new Error('Public package metadata must point to the Graph Workbench repository.');
}

const referenceRegistry = JSON.parse(await readFile(resolve(root, 'registry/reference.json'), 'utf8'));
const referenceSources = referenceRegistry.packs?.map((pack) => pack.source).sort() ?? [];
for (const source of [
  '../packs/cybersecurity-response/src/index.ts',
  '../packs/data-mlops/src/index.ts',
  '../packs/healthcare-diagnostics/src/index.ts',
  '../packs/quantitative-finance/src/index.ts',
  '../packs/software-delivery/src/index.ts',
  '../packs/robotics-fleet/src/index.ts',
]) {
  if (!referenceSources.includes(source)) throw new Error(`Reference Registry is missing ${source}.`);
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || ['node_modules', 'dist', 'release', 'test-results'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(path));
    else if (entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

const markdown = await markdownFiles(root);
for (const file of markdown) {
  const content = await readFile(file, 'utf8');
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const raw = match[1]?.trim().replace(/^<|>$/g, '').split(/\s+['"]/)[0] ?? '';
    if (!raw || raw.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
    const target = decodeURIComponent(raw.split('#')[0] ?? '');
    await access(resolve(dirname(file), target)).catch(() => {
      throw new Error(`Broken local Markdown link in ${file}: ${raw}`);
    });
  }
}

console.log(`Release-readiness metadata passed for ${distribution.name}@${distribution.version}.`);
console.log(`  ${requiredFiles.length} required public project and operations files`);
console.log(`  ${manifests.length} version- and license-aligned package manifests`);
console.log(`  ${referenceSources.length} reference Registry Packs`);
console.log(`  ${markdown.length} Markdown files with valid local links`);
