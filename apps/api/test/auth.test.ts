import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { envSchema } from '../src/config';
import { startApp, type TestApp } from './helpers';

const TEAM = 'team.example.com';
const AUD = 'aud-test';
let t: TestApp;
let privateKey: CryptoKey;

async function jwt(email: string, opts: { aud?: string; iss?: string } = {}) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? `https://${TEAM}`)
    .setAudience(opts.aud ?? AUD)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

beforeAll(async () => {
  const kp = await generateKeyPair('RS256');
  privateKey = kp.privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: 'k1', alg: 'RS256' };
  t = await startApp({
    env: { AUTH_DEV_BYPASS: '0', CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD, ADMIN_EMAIL: 'Admin@Example.com' },
    accessKeys: createLocalJWKSet({ keys: [jwk] }),
  });
});
afterAll(async () => t?.close());

describe('설정', () => {
  it('운영에서는 AUTH_DEV_BYPASS 를 무시하고 Access 설정을 요구한다', () => {
    const base = { DATABASE_URL: 'postgres://x', AUTH_DEV_BYPASS: '1' };
    expect(envSchema.parse({ ...base, NODE_ENV: 'development' }).devBypass).toBe(true);
    expect(envSchema.safeParse({ ...base, NODE_ENV: 'production' }).success).toBe(false);
    const prod = envSchema.parse({
      ...base,
      NODE_ENV: 'production',
      CF_ACCESS_TEAM_DOMAIN: TEAM,
      CF_ACCESS_AUD: AUD,
      ADMIN_EMAIL: 'a@b.c',
    });
    expect(prod.devBypass).toBe(false);
    expect(prod.port).toBe(5100);
    expect(prod.host).toBe('127.0.0.1');
  });
});

describe('Cloudflare Access', () => {
  it('/health 는 인증 없이', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('헤더 없음 → 401 오류 형식', async () => {
    const r = await t.app.inject({ method: 'GET', url: '/v1/admin/station' });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ error: { code: 'unauthorized', message: expect.any(String) } });
  });

  it('유효한 JWT(이메일 대소문자 무시) → 200', async () => {
    const r = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/station',
      headers: { 'cf-access-jwt-assertion': await jwt('admin@example.COM') },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().total).toBe(6);
  });

  it('다른 이메일 → 403, 다른 audience·issuer·서명 → 401', async () => {
    const other = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/station',
      headers: { 'cf-access-jwt-assertion': await jwt('someone@example.com') },
    });
    expect(other.statusCode).toBe(403);
    for (const bad of [
      await jwt('admin@example.com', { aud: 'x' }),
      await jwt('admin@example.com', { iss: 'https://evil' }),
      'not.a.jwt',
    ]) {
      const r = await t.app.inject({
        method: 'GET',
        url: '/v1/admin/station',
        headers: { 'cf-access-jwt-assertion': bad },
      });
      expect(r.statusCode).toBe(401);
    }
  });
});

describe('API 토큰', () => {
  let adminHeaders: Record<string, string>;
  beforeAll(async () => {
    adminHeaders = { 'cf-access-jwt-assertion': await jwt('admin@example.com') };
  });

  it('잘못된 토큰 → 401', async () => {
    const r = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/station',
      headers: { authorization: 'Bearer nope' },
    });
    expect(r.statusCode).toBe(401);
    const r2 = await t.app.inject({ method: 'GET', url: '/v1/admin/station', headers: { authorization: 'Basic x' } });
    expect(r2.statusCode).toBe(401);
  });

  it('발급·범위·폐기', async () => {
    const created = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/tokens',
      headers: adminHeaders,
      payload: { name: 'agent-test', scopes: ['admin:read', 'proposal:write'] },
    });
    expect(created.statusCode).toBe(201);
    const tok = created.json();
    expect(tok.token).toMatch(/^krdx_/);
    expect(tok.user_kind).toBe('agent');
    const bearer = { authorization: `Bearer ${tok.token}` };

    // 목록에 평문·해시가 없다
    const list = await t.app.inject({ method: 'GET', url: '/v1/admin/tokens', headers: adminHeaders });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json())).not.toContain(tok.token);
    expect(JSON.stringify(list.json())).not.toContain('token_hash');

    // admin:read → 읽기 가능, 쓰기 불가, 토큰 관리 불가
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/station', headers: bearer })).statusCode).toBe(200);
    const write = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/station',
      headers: bearer,
      payload: { id: 'stn-x', name_ko: 'x', checked_at: '2026-11-20', sources: [{ source_id: 'src-fixture-notice' }] },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe('forbidden');
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/tokens', headers: bearer })).statusCode).toBe(403);

    // proposal:write → draft 제출(origin agent)
    const draft = await t.app.inject({
      method: 'POST',
      url: '/v1/admin/changesets',
      headers: bearer,
      payload: {
        title: '에이전트 제안',
        origin: 'admin_edit',
        ops: [{ op: 'update', entity_type: 'station', id: 'stn-fx-a', data: { address: '시험로 1' } }],
      },
    });
    expect(draft.statusCode).toBe(201);
    const cs = await t.app.inject({ method: 'GET', url: `/v1/admin/changesets/${draft.json().id}`, headers: bearer });
    expect(cs.json()).toMatchObject({ status: 'draft', origin: 'agent', author: 'agent-test' });
    // 승인은 admin:write
    const approve = await t.app.inject({
      method: 'POST',
      url: `/v1/admin/changesets/${draft.json().id}/approve`,
      headers: bearer,
    });
    expect(approve.statusCode).toBe(403);

    const revoke = await t.app.inject({ method: 'DELETE', url: `/v1/admin/tokens/${tok.id}`, headers: adminHeaders });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().revoked_at).not.toBeNull();
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/station', headers: bearer })).statusCode).toBe(401);
  });

  it('public:read 토큰은 /v1/meta 만, 만료된 토큰은 401', async () => {
    const web = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/admin/tokens',
        headers: adminHeaders,
        payload: { name: 'web', scopes: ['public:read'] },
      })
    ).json();
    const h = { authorization: `Bearer ${web.token}` };
    expect((await t.app.inject({ method: 'GET', url: '/v1/admin/station', headers: h })).statusCode).toBe(403);
    const meta = await t.app.inject({ method: 'GET', url: '/v1/meta', headers: h });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().entities.station.active).toBe(6);
    expect(meta.json().data_version.version).toBeGreaterThan(0);
    expect(meta.json().migrations.length).toBeGreaterThan(10);

    const expired = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/admin/tokens',
        headers: adminHeaders,
        payload: { name: 'old', scopes: ['admin:read'], expires_at: '2020-01-01T00:00:00Z' },
      })
    ).json();
    const r = await t.app.inject({
      method: 'GET',
      url: '/v1/admin/station',
      headers: { authorization: `Bearer ${expired.token}` },
    });
    expect(r.statusCode).toBe(401);
  });

  it('admin:write 토큰(관리자 CLI)은 관리자 사용자로 쓴다', async () => {
    const cli = (
      await t.app.inject({
        method: 'POST',
        url: '/v1/admin/tokens',
        headers: adminHeaders,
        payload: { name: 'cli', scopes: ['admin:write'] },
      })
    ).json();
    expect(cli.user_kind).toBe('admin');
    const r = await t.app.inject({
      method: 'PATCH',
      url: '/v1/admin/station/stn-fx-b',
      headers: { authorization: `Bearer ${cli.token}`, 'if-match': '1' },
      payload: { address: 'CLI 로 수정' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().version).toBe(2);
  });
});
