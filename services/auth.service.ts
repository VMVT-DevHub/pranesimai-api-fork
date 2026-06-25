'use strict';

import cookie from 'cookie';
import jwt from 'jsonwebtoken';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import { ResponseHeadersMeta } from '../types';
import { USER_TOKEN_COOKIE, USER_TOKEN_MAX_AGE_SECONDS } from '../types/auth';
import { MetaSession, RestrictionType } from './api.service';

export interface AuthUser {
  userId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

@Service({
  name: 'auth',
})
export default class AuthService extends moleculer.Service {
  @Action({
    rest: 'POST /start',
  })
  async start(ctx: Context<unknown, ResponseHeadersMeta>) {
    const response: {
      ticket: string;
      host: string;
      url: string;
    } = await ctx.call('http.post', {
      url: `${process.env.VIISP_HOST}/sign`,
      opt: {
        responseType: 'json',
        json: {},
      },
    });

    ctx.meta.$statusCode = 302;
    ctx.meta.$location = response.url;
  }

  @Action({
    rest: 'POST /login',
    params: {
      ticket: 'string',
      customData: 'string|optional',
    },
  })
  async login(ctx: Context<{ ticket: string; customData?: string }, ResponseHeadersMeta>) {
    const data = ctx.params.customData ? JSON.parse(ctx.params.customData) : {};
    const viispData: {
      id?: string;
      email: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
    } = await ctx.call('http.get', {
      url: `${process.env.VIISP_HOST}/data?ticket=${ctx.params.ticket}`,
      opt: {
        responseType: 'json',
      },
    });

    const { id: userId, email, phone, firstName, lastName } = viispData;

    if (!userId) {
      throw new moleculer.Errors.MoleculerClientError(
        'VIISP user id is required.',
        400,
        'VIISP_USER_ID_REQUIRED',
      );
    }

    const token = this.signToken({ userId, email, phone, firstName, lastName });
    this.setCookie(ctx, token);

    if (data.survey) {
      await ctx.call('sessions.startAuthenticated', {
        survey: data.survey,
        userId,
        email,
        phone,
      });
      return;
    }

    ctx.meta.$statusCode = 302;
    ctx.meta.$location = process.env.FRONTEND_URL;
  }

  @Action({
    rest: 'GET /current',
    auth: RestrictionType.USER,
  })
  async current(ctx: Context<unknown, MetaSession>) {
    return ctx.meta.user;
  }

  @Action({
    rest: 'POST /logout',
    auth: RestrictionType.USER,
  })
  async logout(ctx: Context<unknown, ResponseHeadersMeta>) {
    this.removeCookie(ctx);
  }

  @Action()
  async resolveToken(ctx: Context<{ token?: string }>): Promise<AuthUser | undefined> {
    if (!ctx.params.token) return;
    try {
      const payload = jwt.verify(ctx.params.token, process.env.AUTH_JWT_SECRET!) as AuthUser;
      return {
        userId: payload.userId,
        email: payload.email,
        phone: payload.phone,
        firstName: payload.firstName,
        lastName: payload.lastName,
      };
    } catch {
      return;
    }
  }

  @Action()
  async createUserToken(ctx: Context<AuthUser>): Promise<{ token: string }> {
    return { token: this.signToken(ctx.params) };
  }

  @Method
  signToken(user: AuthUser): string {
    return jwt.sign(
      {
        userId: user.userId,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      process.env.AUTH_JWT_SECRET!,
      { expiresIn: USER_TOKEN_MAX_AGE_SECONDS },
    );
  }

  @Method
  setCookie(ctx: Context<unknown, ResponseHeadersMeta>, token: string) {
    ctx.meta.$responseHeaders = {
      ...ctx.meta.$responseHeaders,
      'Set-Cookie': cookie.serialize(USER_TOKEN_COOKIE, token, {
        path: '/',
        httpOnly: true,
        maxAge: USER_TOKEN_MAX_AGE_SECONDS,
      }),
    };
  }

  @Method
  removeCookie(ctx: Context<unknown, ResponseHeadersMeta>) {
    ctx.meta.$responseHeaders = {
      ...ctx.meta.$responseHeaders,
      'Set-Cookie': cookie.serialize(USER_TOKEN_COOKIE, '', {
        path: '/',
        httpOnly: true,
        maxAge: 0,
      }),
    };
  }
}
