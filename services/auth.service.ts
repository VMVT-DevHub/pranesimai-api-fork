'use strict';

import cookie from 'cookie';
import crypto from 'crypto';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import {
  CommonFields,
  CommonPopulates,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  ResponseHeadersMeta,
  Table,
} from '../types';
import { USER_TOKEN_COOKIE, USER_TOKEN_MAX_AGE_SECONDS } from '../types/auth';
import { MetaSession, RestrictionType } from './api.service';

export interface AuthUser {
  userId: string;
  email?: string;
  phone?: string;
}

interface Fields extends CommonFields, AuthUser {
  tokenHash: string;
  expiresAt: Date;
}

export type AuthToken<
  P extends keyof CommonPopulates = never,
  F extends keyof Fields = keyof Fields,
> = Table<Fields, CommonPopulates, P, F>;

@Service({
  name: 'auth',
  mixins: [
    DbConnection({
      collection: 'authTokens',
      rest: false,
    }),
  ],
  settings: {
    fields: {
      id: {
        type: 'number',
        columnType: 'integer',
        primaryKey: true,
        secure: true,
      },
      tokenHash: {
        type: 'string',
        hidden: 'byDefault',
      },
      userId: 'string',
      email: 'string',
      phone: 'string',
      expiresAt: 'date',
      ...COMMON_FIELDS,
    },
    scopes: {
      ...COMMON_SCOPES,
    },
    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
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
      phoneNumber?: string;
    } = await ctx.call('http.get', {
      url: `${process.env.VIISP_HOST}/data?ticket=${ctx.params.ticket}`,
      opt: {
        responseType: 'json',
      },
    });

    const { id: userId, email } = viispData;
    const phone = viispData.phone || viispData.phoneNumber;

    if (!userId) {
      throw new moleculer.Errors.MoleculerClientError(
        'VIISP user id is required.',
        400,
        'VIISP_USER_ID_REQUIRED',
      );
    }

    const { token } = await this.createUserSession(ctx, {
      userId,
      email,
      phone,
    });
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
  async logout(ctx: Context<unknown, MetaSession & ResponseHeadersMeta>) {
    if (ctx.meta.userToken) {
      await this.updateEntity(ctx, {
        id: ctx.meta.userToken.id,
        expiresAt: new Date(),
      });
    }

    this.removeCookie(ctx);
  }

  @Method
  async createUserSession(ctx: Context, user: AuthUser) {
    const token = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + USER_TOKEN_MAX_AGE_SECONDS * 1000);

    await this.createEntity(ctx, {
      tokenHash: this.hashToken(token),
      userId: user.userId,
      email: user.email,
      phone: user.phone,
      expiresAt,
    });

    return {
      ...user,
      token,
    };
  }

  @Action()
  async createUserToken(ctx: Context<AuthUser>) {
    return this.createUserSession(ctx, ctx.params);
  }

  @Action()
  async resolveToken(ctx: Context<{ token?: string }>) {
    if (!ctx.params.token) {
      return;
    }

    const authToken: AuthToken = await this.findEntity(ctx, {
      query: {
        tokenHash: this.hashToken(ctx.params.token),
      },
      fields: ['id', 'userId', 'email', 'phone', 'expiresAt'],
    });

    if (!authToken || new Date(authToken.expiresAt).getTime() < Date.now()) {
      return;
    }

    return authToken;
  }

  @Method
  hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
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
