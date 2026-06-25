import ApiGateway from 'moleculer-web';
import ApiService, { MetaSession, RestrictionType } from '../services/api.service';
import type { ResponseHeadersMeta } from '../types';
import type { Session } from '../services/sessions.service';

// Build a minimal service-like object from the prototype so that methods can
// call each other via `this` (e.g. clearCookie → appendSetCookie) without
// needing a running Moleculer broker or HTTP server.
function makeService() {
  return Object.create(ApiService.prototype) as typeof ApiService.prototype;
}

type TestCtx = {
  meta: MetaSession & ResponseHeadersMeta & { $responseHeaders?: Record<string, any> };
  call: jest.Mock;
};

function makeCtx(callImpl?: (action: string, params: any) => any): TestCtx {
  return {
    meta: {} as any,
    call: jest
      .fn()
      .mockImplementation(
        callImpl
          ? (action: string, params: any) => Promise.resolve(callImpl(action, params))
          : () => Promise.resolve(undefined),
      ),
  };
}

function makeReq(opts: { cookie?: string; actionAuth?: string } = {}) {
  return {
    headers: { cookie: opts.cookie ?? '' },
    $action: { auth: opts.actionAuth },
  };
}

function getSetCookies(ctx: TestCtx): string[] {
  const sc = ctx.meta.$responseHeaders?.['Set-Cookie'];
  if (!sc) return [];
  return ([] as string[]).concat(sc);
}

const validAuthToken = {
  userId: 'user-uuid-1',
  email: 'user@example.com',
  phone: undefined as string | undefined,
};

const activeSession = {
  id: 10,
  finishedAt: undefined as Date | undefined,
  canceledAt: undefined as Date | undefined,
  createdAt: new Date(Date.now() - 1000),
};

// ─── authenticate ─────────────────────────────────────────────────────────────

describe('authenticate', () => {
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
  });

  it('returns the resolved user and sets meta when user token is valid', async () => {
    const ctx = makeCtx((action) => (action === 'auth.resolveToken' ? validAuthToken : undefined));
    const req = makeReq({ cookie: 'vmvt-user-token=valid-token' });

    const result = await svc.authenticate(ctx as any, {} as any, req as any);

    expect(ctx.meta.user).toEqual({
      userId: validAuthToken.userId,
      email: validAuthToken.email,
      phone: validAuthToken.phone,
    });
    expect(result).toEqual(ctx.meta.user);
  });

  it('clears only the user cookie when vmvt-user-token is invalid', async () => {
    const ctx = makeCtx(() => undefined);
    const req = makeReq({ cookie: 'vmvt-user-token=bad-token' });

    await svc.authenticate(ctx as any, {} as any, req as any);

    expect(ctx.meta.user).toBeUndefined();
    const cookies = getSetCookies(ctx);
    expect(cookies.some((h) => h.includes('vmvt-user-token=;'))).toBe(true);
    expect(cookies.every((h) => !h.includes('vmvt-session-token=;'))).toBe(true);
  });

  it('authenticates user without calling sessions.findOne when only user token is present', async () => {
    const ctx = makeCtx((action) => (action === 'auth.resolveToken' ? validAuthToken : undefined));
    const req = makeReq({ cookie: 'vmvt-user-token=valid-token' });

    const result = await svc.authenticate(ctx as any, {} as any, req as any);

    expect(ctx.call).not.toHaveBeenCalledWith('sessions.findOne', expect.anything());
    expect(result).toEqual({
      userId: validAuthToken.userId,
      email: validAuthToken.email,
      phone: validAuthToken.phone,
    });
  });

  it('sets ctx.meta.session for a valid session cookie', async () => {
    const ctx = makeCtx((action) => (action === 'sessions.findOne' ? activeSession : undefined));
    const req = makeReq({ cookie: 'vmvt-session-token=valid-sess' });

    const result = await svc.authenticate(ctx as any, {} as any, req as any);

    expect(ctx.meta.session).toEqual(activeSession);
    expect(result).toBeUndefined();
  });

  it('clears only the session cookie when session is expired (finishedAt set)', async () => {
    const expired = { ...activeSession, finishedAt: new Date() };
    const ctx = makeCtx((action) => (action === 'sessions.findOne' ? expired : undefined));
    const req = makeReq({ cookie: 'vmvt-session-token=expired-sess' });

    await svc.authenticate(ctx as any, {} as any, req as any);

    expect(ctx.meta.session).toBeUndefined();
    const cookies = getSetCookies(ctx);
    expect(cookies.some((h) => h.includes('vmvt-session-token=;'))).toBe(true);
    expect(cookies.every((h) => !h.includes('vmvt-user-token=;'))).toBe(true);
  });

  it('clears session cookie when session token is present in cookie but absent from DB', async () => {
    const ctx = makeCtx(() => undefined);
    const req = makeReq({ cookie: 'vmvt-session-token=stale-token' });

    await svc.authenticate(ctx as any, {} as any, req as any);

    expect(ctx.meta.session).toBeUndefined();
    const cookies = getSetCookies(ctx);
    expect(cookies.some((h) => h.includes('vmvt-session-token=;'))).toBe(true);
  });

  it('clears both cookies in a single response when both are invalid', async () => {
    const expired = { ...activeSession, finishedAt: new Date() };
    const ctx = makeCtx((action) => {
      if (action === 'auth.resolveToken') return undefined;
      if (action === 'sessions.findOne') return expired;
      return undefined;
    });
    const req = makeReq({ cookie: 'vmvt-user-token=bad; vmvt-session-token=expired' });

    await svc.authenticate(ctx as any, {} as any, req as any);

    const cookies = getSetCookies(ctx);
    expect(cookies).toHaveLength(2);
    expect(cookies.some((h) => h.includes('vmvt-user-token=;'))).toBe(true);
    expect(cookies.some((h) => h.includes('vmvt-session-token=;'))).toBe(true);
  });
});

// ─── authorize ────────────────────────────────────────────────────────────────

describe('authorize', () => {
  let svc: ReturnType<typeof makeService>;

  beforeEach(() => {
    svc = makeService();
  });

  it('allows PUBLIC routes without user or session', async () => {
    const ctx = makeCtx();
    const req = makeReq({ actionAuth: RestrictionType.PUBLIC });
    await expect(svc.authorize(ctx as any, {} as any, req as any)).resolves.toBeUndefined();
  });

  it('allows USER route when ctx.meta.user is set', async () => {
    const ctx = makeCtx();
    ctx.meta.user = { userId: 'u-1', email: undefined, phone: undefined };
    const req = makeReq({ actionAuth: RestrictionType.USER });
    await expect(svc.authorize(ctx as any, {} as any, req as any)).resolves.toBeUndefined();
  });

  it('throws 401 on USER route when ctx.meta.user is missing', async () => {
    const ctx = makeCtx();
    const req = makeReq({ actionAuth: RestrictionType.USER });
    await expect(svc.authorize(ctx as any, {} as any, req as any)).rejects.toBeInstanceOf(
      ApiGateway.Errors.UnAuthorizedError,
    );
  });

  it('allows SESSION route when ctx.meta.session is set', async () => {
    const ctx = makeCtx();
    ctx.meta.session = activeSession as Session;
    const req = makeReq({ actionAuth: RestrictionType.SESSION });
    await expect(svc.authorize(ctx as any, {} as any, req as any)).resolves.toBeUndefined();
  });

  it('throws 401 on SESSION route when ctx.meta.session is missing', async () => {
    const ctx = makeCtx();
    const req = makeReq({ actionAuth: RestrictionType.SESSION });
    await expect(svc.authorize(ctx as any, {} as any, req as any)).rejects.toBeInstanceOf(
      ApiGateway.Errors.UnAuthorizedError,
    );
  });
});
