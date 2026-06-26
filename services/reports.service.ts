'use strict';

import moleculer, { Context } from 'moleculer';
import { Service, Event, Action } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { stringify } from 'csv-stringify/sync';

import {
  CommonFields,
  CommonPopulates,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  Table,
} from '../types';
import { throwNotFoundError, throwUnauthorizedError } from '../types/errors';
import { MetaSession, RestrictionType } from './api.service';
import { Question, QuestionType } from './questions.service';
import { Session } from './sessions.service';
import { Response } from './responses.service';
import { Survey, SurveyAuthType } from './surveys.service';

export enum ReportStatus {
  SUBMITTED = 'SUBMITTED',
  IMPORTED = 'IMPORTED',
  IN_REVIEW = 'IN_REVIEW',
  DONE = 'DONE',
  REJECTED = 'REJECTED',
  FAILED = 'FAILED',
}

interface Fields extends CommonFields {
  session: Session['id'];
  survey: Survey['id'];
  spList: Survey['spList'];
  status: ReportStatus;
  externalId: string;
  statusUpdatedAt: Date;
  statusMessage: string;
  startedAt: Date;
  finishedAt: Date;
  auth: boolean;
  email: string;
  phone: string;
  answers: Array<{
    questionId?: Question['id'];
    title: Question['title'];
    answer: any;
    type?: QuestionType;
    required: Question['required'];
    riskEvaluation: Question['riskEvaluation'];
    spField: Question['spField'];
    customLogic?: Question['customLogic'];
  }>;
  csv: string;
}

interface Populates extends CommonPopulates {
  session: Session;
  survey: Survey;
}

export type Report<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'reports',
  mixins: [
    DbConnection({
      collection: 'reports',
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

      session: {
        type: 'number',
        columnType: 'integer',
        columnName: 'sessionId',
        populate: {
          action: 'sessions.resolve',
        },
      },

      survey: {
        type: 'number',
        columnType: 'integer',
        columnName: 'surveyId',
        populate: {
          action: 'surveys.resolve',
        },
      },

      spList: 'string',
      status: {
        type: 'string',
        enum: Object.values(ReportStatus),
        default: ReportStatus.SUBMITTED,
      },
      externalId: 'string',
      statusUpdatedAt: 'date',
      statusMessage: 'string',
      startedAt: 'date',
      finishedAt: 'date',
      auth: 'boolean',
      email: 'string',
      phone: 'string',
      answers: 'any',
      csv: 'any',

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class ReportsService extends moleculer.Service {
  @Action({
    rest: 'GET /my',
    auth: RestrictionType.USER,
  })
  async my(ctx: Context<unknown, MetaSession>) {
    if (!ctx.meta.user?.userId) {
      throwUnauthorizedError('Authenticated user is required.');
    }

    const sessions: Array<Session<'survey'>> = await ctx.call('sessions.userHistory');
    const sessionIds = sessions.map((session) => session.id);

    const reports: Array<Report<'survey'>> = sessionIds.length
      ? await this.findEntities(ctx, {
          query: {
            session: { $in: sessionIds },
          },
          populate: 'survey',
          sort: '-finishedAt',
        })
      : [];

    const drafts = sessions
      .filter((session) => !session.finishedAt && !session.canceledAt)
      .map((session) => ({
        type: 'draft',
        id: session.id,
        status: 'DRAFT',
        survey: session.survey,
        lastResponse: session.lastResponse,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      }));

    const reportItems = reports.map((report) => ({
      type: 'report',
      id: report.id,
      session: report.session,
      status: report.status,
      externalId: report.externalId,
      survey: report.survey,
      startedAt: report.startedAt,
      finishedAt: report.finishedAt,
      statusUpdatedAt: report.statusUpdatedAt,
      statusMessage: report.statusMessage,
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
      auth: report.auth,
    }));

    return {
      items: [...drafts, ...reportItems].sort(
        (a, b) =>
          new Date(b.updatedAt || b.createdAt || 0).getTime() -
          new Date(a.updatedAt || a.createdAt || 0).getTime(),
      ),
    };
  }

  @Action({
    rest: 'GET /my/:id',
    auth: RestrictionType.USER,
    params: {
      id: 'number|convert',
    },
  })
  async getMy(ctx: Context<{ id: Report['id'] }, MetaSession>) {
    if (!ctx.meta.user?.userId) {
      throwUnauthorizedError('Authenticated user is required.');
    }

    const sessions: Array<Session> = await ctx.call('sessions.userHistory');
    const sessionIds = sessions.map((session) => session.id);

    const report: Report<'survey'> = await this.findEntity(ctx, {
      query: {
        id: ctx.params.id,
        session: { $in: sessionIds },
      },
      populate: 'survey',
    });

    if (!report) {
      throwNotFoundError('Report not found.');
    }

    return report;
  }

  @Action({
    params: {
      id: 'number|convert',
      status: {
        type: 'string',
        enum: Object.values(ReportStatus),
      },
      externalId: 'string|optional',
      statusMessage: 'string|optional',
    },
  })
  async updateStatus(
    ctx: Context<{
      id: Report['id'];
      status: ReportStatus;
      externalId?: Report['externalId'];
      statusMessage?: Report['statusMessage'];
    }>,
  ) {
    return this.updateEntity(ctx, {
      id: ctx.params.id,
      status: ctx.params.status,
      externalId: ctx.params.externalId,
      statusMessage: ctx.params.statusMessage,
      statusUpdatedAt: new Date(),
    });
  }

  @Event()
  async 'sessions.finished'(ctx: Context<Session>) {
    const session = ctx.params;
    let responseId = session.lastResponse;

    const responses: Array<Response<'page' | 'questions'>> = [];
    while (responseId) {
      const response: Response<'page' | 'questions'> = await ctx.call('responses.resolve', {
        id: responseId,
        populate: 'page,questions',
      });

      responses.push(response);
      responseId = response.previousResponse;
    }
    responses.reverse();

    const survey: Survey = await ctx.call('surveys.resolve', { id: session.survey });

    const answers: Report['answers'] = [];
    if (survey.authType === SurveyAuthType.OPTIONAL) {
      answers.push({
        title: 'Ar anonimas?',
        answer: session.auth ? 'Ne' : 'Taip',
        required: true,
        riskEvaluation: false,
        spField: 'Anonimas',
      });
    }

    for (const response of responses) {
      for (const question of response.questions) {
        const value = response.values[question.id];
        let answer = value;

        if (question.condition) {
          const allConditionsMet = question.condition.every((condition) => {
            const { question: conditionQuestion, value: conditionValue } = condition;
            const responseValue = response.values[conditionQuestion];

            if (Array.isArray(responseValue)) {
              return responseValue.includes(conditionValue);
            } else {
              return responseValue === conditionValue;
            }
          });

          if (!allConditionsMet) {
            continue;
          }
        }

        if (value) {
          switch (question.type) {
            case QuestionType.RADIO:
            case QuestionType.INFOCARD:
            case QuestionType.SELECT: {
              // case QuestionType.ADDRESS:
              const option = question.options.find((o) => o.id === value);
              if (!option) {
                continue;
              }
              answer = option.title;

              break;
            }

            case QuestionType.MULTISELECT:
              answer = [];
              answer.toString = function () {
                return this.join(', ');
              };

              for (const item of value) {
                const option = question.options.find((o) => o.id === item);
                if (!option) {
                  continue;
                }
                answer.push(option.title);
              }

              break;

            case QuestionType.FILES:
              answer = value.map((item: any) => item.url);
              answer.toString = function () {
                return this.join(', ');
              };

              break;

            case QuestionType.LOCATION:
              answer = value.features?.[0]?.geometry?.coordinates || [];
              answer.toString = function () {
                return this.join(', ');
              };
              break;
          }
        }

        answers.push({
          questionId: question.id,
          title: question.title,
          answer,
          type: question.type,
          required: question.required,
          riskEvaluation: question.riskEvaluation,
          spField: question.spField,
        });
      }
    }

    const csv = stringify([
      ['Sesijos ID', session.id],
      ['Apklausos ID', survey.id],
      ['Apklausa', survey.title],
      ['Pradžia', session.createdAt.toLocaleString()],
      ['Pabaiga', session.finishedAt.toLocaleString()],
      ['Anonimiškai', (!session.auth).toString()],
      ['El.paštas', session.email],
      ['Tel.nr.', session.phone],
      [],
      ['Klausimo ID', 'Klausimas', 'Atsakymas', 'Tipas', 'Privalomas', 'Vertinama rizika'],
      ...answers.map((answer) => Object.values(answer).map((value) => value?.toString())),
    ]);

    await this.createEntity(ctx, <Partial<Report>>{
      session: session.id,
      survey: session.survey,
      spList: survey.spList,
      status: ReportStatus.SUBMITTED,
      statusUpdatedAt: session.finishedAt,
      startedAt: session.createdAt,
      finishedAt: session.finishedAt,
      auth: session.auth,
      email: session.email,
      phone: session.phone,
      answers,
      csv,
    });
  }
}
