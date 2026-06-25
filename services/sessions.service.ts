'use strict';

import cookie from 'cookie';
import crypto from 'crypto';
import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { Survey, SurveyAuthType } from './surveys.service';

import {
  CommonFields,
  CommonPopulates,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  SESSION_MAX_AGE_SECONDS,
  Table,
  ResponseHeadersMeta,
} from '../types';
import { SESSION_TOKEN_COOKIE, USER_TOKEN_COOKIE, USER_TOKEN_MAX_AGE_SECONDS } from '../types/auth';
import { Response, TraverseGraphResponse } from './responses.service';
import { MetaSession, RestrictionType } from './api.service';
import type { AuthUser } from './auth.service';

interface Fields extends CommonFields {
  token: string;
  userId: string;
  survey: Survey['id'];
  lastResponse: Response['id'];
  finishedAt: Date;
  canceledAt: Date;
  auth: boolean;
  phone: string;
  email: string;
}

interface Populates extends CommonPopulates {
  survey: Survey;
  lastResponse: Response;
}

export type Session<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'sessions',

  mixins: [
    DbConnection({
      collection: 'sessions',
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

      survey: {
        type: 'number',
        columnType: 'integer',
        columnName: 'surveyId',
        required: true,
        populate: {
          action: 'surveys.resolve',
        },
      },

      lastResponse: {
        type: 'number',
        columnType: 'integer',
        columnName: 'lastResponseId',
        populate: {
          action: 'responses.resolve',
        },
      },

      token: {
        type: 'string',
        hidden: 'byDefault',
      },

      userId: 'string',
      auth: 'boolean',
      email: 'string',
      phone: 'string',

      finishedAt: 'date',
      canceledAt: 'date',

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,

      async session(q: any, ctx: Context<unknown, MetaSession>) {
        if (!ctx?.meta?.session) return q;

        return {
          ...q,
          id: ctx.meta.session.id,
        };
      },
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES, 'session'],
  },
})
export default class SessionsService extends moleculer.Service {
  @Action({
    rest: 'GET /current',
    auth: RestrictionType.SESSION,
  })
  async current(ctx: Context<unknown, MetaSession>) {
    return ctx.meta.session;
  }

  @Action({
    rest: 'POST /start',
    params: {
      survey: 'number|convert',
      auth: 'boolean|convert|optional',
    },
  })
  async start(
    ctx: Context<{ survey: Survey['id']; auth?: boolean }, ResponseHeadersMeta & MetaSession>,
  ) {
    const survey: Survey = await ctx.call('surveys.resolve', {
      id: ctx.params.survey,
      throwIfNotExist: true,
    });

    const shouldRequireAuth =
      survey.authType === SurveyAuthType.REQUIRED ||
      (survey.authType === SurveyAuthType.OPTIONAL &&
        !!(ctx.params.auth || ctx.meta.isExternalRequest));

    if (shouldRequireAuth && !ctx.meta.user) {
      const response: {
        ticket: string;
        host: string;
        url: string;
      } = await ctx.call('http.post', {
        url: `${process.env.VIISP_HOST}/sign`,
        opt: {
          responseType: 'json',
          json: {
            survey: survey.id,
          },
        },
      });

      ctx.meta.$statusCode = 302;
      ctx.meta.$location = response.url;
    } else {
      await this.startSurvey(
        ctx,
        survey.id,
        shouldRequireAuth,
        ctx.meta.user?.email,
        ctx.meta.user?.phone,
        ctx.meta.user?.userId,
      );
    }
  }

  @Action({
    rest: 'POST /evartai',
    params: {
      ticket: 'string',
      customData: 'string',
    },
  })
  async evartai(ctx: Context<{ ticket: string; customData: string }, ResponseHeadersMeta>) {
    const { ticket, customData } = ctx.params;
    const data = customData ? JSON.parse(customData) : {};
    const { survey }: { survey?: Survey['id'] } = data;

    const viispData: {
      id?: string;
      email: string;
      phone?: string;
      firstName?: string;
      lastName?: string;
    } = await ctx.call('http.get', {
      url: `${process.env.VIISP_HOST}/data?ticket=${ticket}`,
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

    const user: AuthUser = {
      userId,
      email,
      phone,
      firstName,
      lastName,
    };

    const { token }: { token: string } = await ctx.call('auth.createUserToken', user);
    const setUserCookie = cookie.serialize(USER_TOKEN_COOKIE, token, {
      path: '/',
      httpOnly: true,
      maxAge: USER_TOKEN_MAX_AGE_SECONDS,
    });
    const existingSetCookie = ctx.meta.$responseHeaders?.['Set-Cookie'];
    ctx.meta.$responseHeaders = {
      ...ctx.meta.$responseHeaders,
      'Set-Cookie': Array.isArray(existingSetCookie)
        ? [...existingSetCookie, setUserCookie]
        : existingSetCookie
        ? [existingSetCookie, setUserCookie]
        : setUserCookie,
    };

    if (survey) {
      await this.startSurvey(ctx, survey, true, email, phone, userId);
      return;
    }

    ctx.meta.$statusCode = 302;
    ctx.meta.$location = process.env.FRONTEND_URL;
  }

  @Action({
    params: {
      survey: 'number|convert',
      userId: 'string',
      email: 'string|optional',
      phone: 'string|optional',
    },
  })
  async startAuthenticated(
    ctx: Context<
      {
        survey: Survey['id'];
        userId: AuthUser['userId'];
        email?: AuthUser['email'];
        phone?: AuthUser['phone'];
      },
      ResponseHeadersMeta & MetaSession
    >,
  ) {
    await this.startSurvey(
      ctx,
      ctx.params.survey,
      true,
      ctx.params.email,
      ctx.params.phone,
      ctx.params.userId,
    );
  }

  @Method
  async startSurvey(
    ctx: Context<unknown, ResponseHeadersMeta & MetaSession>,
    id: Survey['id'],
    auth: Session['auth'],
    email?: Session['email'],
    phone?: Session['phone'],
    userId?: Session['userId'],
  ) {
    const survey: Survey<'firstPage'> = await ctx.call('surveys.resolve', {
      id: id,
      populate: 'firstPage',
      throwIfNotExist: true,
    });

    const { questions, page }: TraverseGraphResponse = await ctx.call(
      'responses.traverseQuestionsGraph',
      {
        startingQuestions: survey.firstPage.questions.map((q) => q.id),
        skipAuthQuestions: !auth,
        skipAnonQuestions: auth,
      },
    );

    let session: Session;
    let token: string | undefined;

    if (ctx.meta.session?.id) {
      session = await this.updateEntity(ctx, {
        id: ctx.meta.session.id,
        survey: survey.id,
        auth,
        email,
        phone,
        userId,
      });
    } else {
      token = crypto.randomBytes(64).toString('hex');
      session = await this.createEntity(ctx, {
        survey: survey.id,
        auth,
        email,
        phone,
        userId,
        token,
      });
      const setCookie = cookie.serialize(SESSION_TOKEN_COOKIE, token, {
        path: '/',
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_SECONDS,
      });
      const existingSetCookie = ctx.meta.$responseHeaders?.['Set-Cookie'];
      ctx.meta.$responseHeaders = {
        ...ctx.meta.$responseHeaders,
        'Set-Cookie': Array.isArray(existingSetCookie)
          ? [...existingSetCookie, setCookie]
          : existingSetCookie
          ? [existingSetCookie, setCookie]
          : setCookie,
      };
    }

    let lastResponse: Response = await ctx.call('responses.findOne', {
      query: {
        session: session.id,
        page,
      },
    });

    if (lastResponse) {
      lastResponse = await ctx.call('responses.update', {
        id: lastResponse.id,
        questions,
      });
    } else {
      lastResponse = await ctx.call('responses.create', {
        session: session.id,
        page,
        questions,
      });
    }

    await this.updateEntity(ctx, {
      id: session.id,
      lastResponse: lastResponse.id,
    });

    ctx.meta.$statusCode = 302;
    ctx.meta.$location = process.env.FRONTEND_URL;
  }

  @Action({
    params: {
      id: 'number',
    },
  })
  async finish(ctx: Context<{ id: Session['id'] }, ResponseHeadersMeta>) {
    const session = await this.updateEntity(ctx, {
      id: ctx.params.id,
      finishedAt: new Date(),
    });

    ctx.emit('sessions.finished', session);

    this.removeCookie(ctx);
  }

  @Action({
    rest: 'POST /cancel',
    auth: RestrictionType.SESSION,
  })
  async cancel(ctx: Context<unknown, MetaSession & ResponseHeadersMeta>) {
    if (!ctx.meta.session) {
      return;
    }

    await this.updateEntity(ctx, {
      id: ctx.meta.session.id,
      canceledAt: new Date(),
    });

    this.removeCookie(ctx);
  }

  @Action({
    auth: RestrictionType.USER,
  })
  async userHistory(ctx: Context<unknown, MetaSession>) {
    if (!ctx.meta.user?.userId) {
      return [];
    }

    return this.findEntities(ctx, {
      query: {
        userId: ctx.meta.user.userId,
      },
      populate: 'survey',
      scope: '-session',
      sort: '-updatedAt',
    });
  }

  @Method
  removeCookie(ctx: Context<unknown, ResponseHeadersMeta>) {
    const setCookie = cookie.serialize(SESSION_TOKEN_COOKIE, '', {
      path: '/',
      httpOnly: true,
      maxAge: 0,
    });
    const existingSetCookie = ctx.meta.$responseHeaders?.['Set-Cookie'];
    ctx.meta.$responseHeaders = {
      ...ctx.meta.$responseHeaders,
      'Set-Cookie': Array.isArray(existingSetCookie)
        ? [...existingSetCookie, setCookie]
        : existingSetCookie
        ? [existingSetCookie, setCookie]
        : setCookie,
    };
  }

  @Method
  async checkScopeAuthority(
    _ctx: Context<unknown, MetaSession>,
    scopeName: string,
    operation: 'add' | 'remove',
  ) {
    if (scopeName === 'session') {
      if (operation === 'remove') {
        return (_ctx as any).action?.name === 'sessions.userHistory';
      }
    }

    return true;
  }
}
