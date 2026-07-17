// Netlify Personal does not enforce the Basic-Auth custom response header.
// This Edge Function is the real, fail-closed access boundary for every path.
// Credentials stay in Netlify's secret store and are never bundled into the app.

const CREDENTIALS_KEY = 'NETLIFY_BASIC_AUTH_CREDENTIALS';
const REALM = 'Conductor Web';
const encoder = new TextEncoder();

function plainResponse(message, status, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'content-type': 'text/plain; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export function parseCredentialList(value) {
  const raw = String(value || '').trim();
  if (!raw || /REPLACE_ME/i.test(raw)) return null;

  const pairs = raw.split(/\s+/).filter(Boolean);
  if (!pairs.length || pairs.some((pair) => !/^[^:\s]+:[^:\s]{12,}$/.test(pair))) {
    return null;
  }
  return pairs;
}

export function decodeBasicAuthorization(header) {
  const match = /^Basic\s+([^\s]+)$/i.exec(String(header || '').trim());
  if (!match) return null;

  try {
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function equalDigest(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function credentialsMatch(presented, allowedPairs) {
  const presentedDigest = await sha256(presented);
  let matched = false;

  // Compare every configured credential so the result does not reveal which
  // account matched through an early return.
  for (const allowed of allowedPairs) {
    matched = equalDigest(presentedDigest, await sha256(allowed)) || matched;
  }
  return matched;
}

export default async function basicAuth(request, context) {
  const allowedPairs = parseCredentialList(Netlify.env.get(CREDENTIALS_KEY));
  if (!allowedPairs) {
    console.error('[basic-auth] Access gate credential configuration is missing or invalid.');
    return plainResponse('Access gate unavailable. Contact the site owner.', 503);
  }

  const presented = decodeBasicAuthorization(request.headers.get('authorization'));
  if (!presented || !(await credentialsMatch(presented, allowedPairs))) {
    return plainResponse('Authentication required.', 401, {
      'www-authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
    });
  }

  // Do not allow an authenticated response to enter a shared cache. This is
  // deliberately conservative for the private beta and prevents later users
  // receiving content cached for an authenticated request.
  const downstream = await context.next();
  const headers = new Headers(downstream.headers);
  headers.set('cache-control', 'private, no-store');

  return new Response(downstream.body, {
    status: downstream.status,
    statusText: downstream.statusText,
    headers,
  });
}

export const config = { path: '/*' };
