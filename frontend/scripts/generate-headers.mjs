#!/usr/bin/env node
// generate-headers.mjs — postbuild step.
//
// WHY THIS EXISTS: public/_headers previously carried a literal Netlify
// Basic-Auth rule with placeholder credentials (paul:REPLACE_ME_1, etc.)
// committed straight into the repo. That means every clone/zip of this
// codebase shipped a documented, guessable access gate — the opposite of a
// commercial access control (flagged in the 15 Jul 2026 Commercial
// Readiness Audit, P0: "Remove placeholder credentials from release
// configuration and maintain secrets only in deployment secret stores.").
//
// Netlify only enforces that custom Basic-Auth header on Pro/Enterprise.
// Personal-plan access control is therefore implemented by
// netlify/edge-functions/basic-auth.js. This postbuild step validates that
// the same runtime secret exists and is well formed, while keeping
// public/_headers permanently credential-free.
//
// Required env var: NETLIFY_BASIC_AUTH_CREDENTIALS
//   Format: "user1:pass1 user2:pass2 user3:pass3"
//   (space-separated user:pass pairs, no surrounding quotes needed.)
//
// Set this in Netlify: Site settings -> Environment variables (or your
// CI's secret store). NEVER put real values in .env files, NEVER put real
// values in public/_headers, NEVER put real values in a shared/zipped
// copy of this repo.
//
// Deliberately NOT a VITE_-prefixed variable: Vite inlines VITE_* vars into
// the client bundle, which would leak the password to every visitor before
// they've even authenticated. This must stay a build/CI-only env var.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const headersPath = join(distDir, '_headers');

const creds = (process.env.NETLIFY_BASIC_AUTH_CREDENTIALS || '').trim();

function fail(message) {
  console.error(`\n[generate-headers] ${message}\n`);
  process.exit(1);
}

if (!existsSync(distDir)) {
  // Don't silently no-op if someone runs this before `vite build` —
  // that would leave a stale or missing dist/_headers and nobody would
  // notice until the deploy was already live and unprotected.
  fail('dist/ does not exist yet. Run `vite build` before this script (see package.json "build" script order).');
}

if (!creds) {
  if (process.env.ALLOW_BUILD_WITHOUT_BASIC_AUTH === '1') {
    console.warn(
      '[generate-headers] Build-time credential validation was skipped because ' +
      'ALLOW_BUILD_WITHOUT_BASIC_AUTH=1 was passed. The deployed Edge Function ' +
      'will still fail closed unless NETLIFY_BASIC_AUTH_CREDENTIALS is available at runtime.'
    );
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      headersPath,
      '# Access is enforced at runtime by netlify/edge-functions/basic-auth.js.\n' +
      '# Build-time credential validation was skipped (ALLOW_BUILD_WITHOUT_BASIC_AUTH=1).\n'
    );
    process.exit(0);
  }
  fail(
    'NETLIFY_BASIC_AUTH_CREDENTIALS is not set. Refusing to produce a ' +
    'build without validated access-gate configuration.\n' +
    '  Set it in your deploy platform\'s environment variables, format:\n' +
    '    "user1:pass1 user2:pass2"\n' +
    '  For a genuinely local/throwaway build with no gate needed, set\n' +
    '  ALLOW_BUILD_WITHOUT_BASIC_AUTH=1 to bypass this check explicitly.'
  );
}

if (/REPLACE_ME/i.test(creds)) {
  fail('NETLIFY_BASIC_AUTH_CREDENTIALS still contains a REPLACE_ME placeholder value — set real credentials.');
}

const pairs = creds.split(/\s+/).filter(Boolean);
const badPair = pairs.find(p => !/^[^:\s]+:[^:\s]{12,}$/.test(p));
if (badPair) {
  fail(
    `Credential pair "${badPair.split(':')[0]}:***" looks malformed or the ` +
    'password is under 12 characters. Format must be "user:pass" with a ' +
    'password of at least 12 characters.'
  );
}

writeFileSync(
  headersPath,
  '# Access is enforced at runtime by netlify/edge-functions/basic-auth.js.\n' +
  `# Build-time credential configuration validated for ${pairs.length} user(s).\n`
);
console.log(`[generate-headers] Edge access-gate configuration validated for ${pairs.length} user(s).`);
