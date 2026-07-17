import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import basicAuth from '../../netlify/edge-functions/basic-auth.js';

const VALID_SECRET = 'paul:a-strong-password';

function request(authorization) {
  const headers = authorization ? { authorization } : {};
  return new Request('https://conductor-web-live.netlify.app/', { headers });
}

function basic(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function context() {
  return {
    next: vi.fn(async () => new Response('<html>private app</html>', {
      status: 200,
      headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=3600' },
    })),
  };
}

beforeEach(() => {
  vi.stubGlobal('Netlify', { env: { get: vi.fn(() => VALID_SECRET) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Netlify Edge Basic Auth gate', () => {
  it('fails closed with 503 when the deployment secret is missing', async () => {
    Netlify.env.get.mockReturnValue('');
    const ctx = context();
    const response = await basicAuth(request(), ctx);

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(ctx.next).not.toHaveBeenCalled();
  });

  it('fails closed with 503 for malformed or placeholder credentials', async () => {
    for (const invalid of ['paul:short', 'paul:REPLACE_ME_1', 'missing-colon']) {
      Netlify.env.get.mockReturnValue(invalid);
      const ctx = context();
      expect((await basicAuth(request(), ctx)).status).toBe(503);
      expect(ctx.next).not.toHaveBeenCalled();
    }
  });

  it('challenges a request with no credentials', async () => {
    const ctx = context();
    const response = await basicAuth(request(), ctx);

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Basic realm="Conductor Web", charset="UTF-8"');
    expect(ctx.next).not.toHaveBeenCalled();
  });

  it('rejects wrong and malformed authorization values', async () => {
    for (const authorization of [basic('paul:wrong-password'), 'Basic !!!not-base64!!!', 'Bearer token']) {
      const ctx = context();
      expect((await basicAuth(request(authorization), ctx)).status).toBe(401);
      expect(ctx.next).not.toHaveBeenCalled();
    }
  });

  it('accepts a configured credential and continues to the private app', async () => {
    const ctx = context();
    const response = await basicAuth(request(basic(VALID_SECRET)), ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('private app');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(ctx.next).toHaveBeenCalledOnce();
  });

  it('supports more than one configured user', async () => {
    Netlify.env.get.mockReturnValue(`${VALID_SECRET} engineer:another-long-password`);
    const ctx = context();
    const response = await basicAuth(request(basic('engineer:another-long-password')), ctx);

    expect(response.status).toBe(200);
    expect(ctx.next).toHaveBeenCalledOnce();
  });
});
