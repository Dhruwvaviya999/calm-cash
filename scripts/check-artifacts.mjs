// Production artefact sanity check, run after `pnpm build` (CI and before a release):
//
//   node scripts/check-artifacts.mjs [--production]
//
// 1. Every package the API and worker bundles import at run time is declared in that app's
//    `dependencies` (pnpm's strict layout would otherwise fail only in production).
// 2. Browser assets of the web build contain no server secrets or connection strings.
// 3. With --production: browser assets reference no localhost or private-network API origin, and
//    no source maps are published.
import { readdir, readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const production = process.argv.includes('--production');
const problems = [];

async function files(dir, keep) {
  const found = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path, keep)));
    else if (keep(entry.name)) found.push(path);
  }
  return found;
}

const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

for (const app of ['api', 'worker']) {
  const dir = join(root, 'apps', app);
  const manifest = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  const declared = new Set(Object.keys(manifest.dependencies ?? {}));
  const bundles = await files(join(dir, 'dist'), (name) => name.endsWith('.js'));
  if (bundles.length === 0) problems.push(`apps/${app}: no build output in dist/ (run pnpm build)`);
  for (const bundle of bundles) {
    const code = await readFile(bundle, 'utf8');
    const imports = [
      ...code.matchAll(/(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']/gm),
      ...code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of new Set(imports)) {
      if (specifier.startsWith('.') || builtins.has(specifier)) continue;
      const name = packageName(specifier);
      if (!declared.has(name)) {
        problems.push(
          `${relative(root, bundle)} imports "${name}", not in apps/${app} dependencies`,
        );
      }
    }
  }
}

const webStatic = join(root, 'apps', 'web', '.next', 'static');
const assets = await files(webStatic, (name) => /\.(js|css|map)$/.test(name));
if (assets.length === 0) problems.push('apps/web: no .next/static output (run pnpm build)');
const SECRET_PATTERNS = [
  [/postgres(?:ql)?:\/\/[^\s"'`]+/i, 'a PostgreSQL connection string'],
  [/vercel_blob_rw_[A-Za-z0-9_]+/, 'a Vercel Blob token'],
  [
    /\b(?:DATABASE_URL|DIRECT_URL|SMTP_PASSWORD|BLOB_READ_WRITE_TOKEN|OPS_STATUS_TOKEN)\b/,
    'a server-only variable name',
  ],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];
const PRIVATE_ORIGIN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)(?::\d+)?/;
for (const asset of assets) {
  const text = await readFile(asset, 'utf8');
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(text)) problems.push(`${relative(root, asset)} contains ${label}`);
  }
  if (production) {
    if (asset.endsWith('.map')) problems.push(`${relative(root, asset)}: source map published`);
    const origin = PRIVATE_ORIGIN.exec(text);
    if (origin !== null) {
      problems.push(`${relative(root, asset)} references a private origin (${origin[0]})`);
    }
  }
}

if (problems.length > 0) {
  process.stderr.write(`Artefact check failed:\n  - ${problems.join('\n  - ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `Artefact check passed (${String(assets.length)} web assets${production ? ', production rules' : ''}).\n`,
);
