'use strict';

import moleculer, { Context } from 'moleculer';
import { Action, Method, Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';
import { Session } from './sessions.service';
import { AuthRelation, Question, QuestionType } from './questions.service';

import {
  CommonFields,
  CommonPopulates,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  Table,
  FieldHookCallback,
} from '../types';
import { Page } from './pages.service';
import { QuestionOption } from './questionOptions.service';
import { MetaSession, RestrictionType } from './api.service';

interface Fields extends CommonFields {
  session: Session['id'];
  page: Page['id'];
  previousResponse: Response['id'];
  questions: Array<Question['id']>;
  values: Record<Question['id'], any>;
  progress: {
    current: number;
    total: number;
  };
}

interface Populates extends CommonPopulates {
  session: Session;
  page: Page;
  previousResponse: Response;
  questions: Array<Question<'options'>>;
}

export interface TraverseGraphResponse {
  questions: Array<Question['id']>;
  nextPageQuestions: Array<Question['id']>;
  page: Page['id'];
}

export type Response<
  P extends keyof Populates = never,
  F extends keyof (Fields & Populates) = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'responses',
  mixins: [
    DbConnection({
      collection: 'responses',
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
        required: true,
        populate: {
          action: 'sessions.resolve',
        },
      },

      page: {
        type: 'number',
        columnType: 'integer',
        columnName: 'pageId',
        required: true,
        populate(ctx: Context, _values: any, responses: any[]) {
          return Promise.all(
            responses.map(async (response) => {
              let { dynamicFields, ...page }: Page = await ctx.call('pages.resolve', {
                id: response.pageId,
              });

              if (dynamicFields) {
                const { values: prevValues } = await this.resolveEntities(ctx, {
                  id: response.id,
                  fields: 'values',
                });

                dynamicFields.forEach((df) => {
                  if (prevValues[df.condition.question] === df.condition.value) {
                    page = {
                      ...page,
                      ...df.values,
                    };
                  }
                });
              }

              return page;
            }),
          );
        },
      },

      previousResponse: {
        type: 'number',
        columnType: 'integer',
        columnName: 'previousResponseId',
        populate: {
          action: 'responses.resolve',
        },
      },

      questions: {
        type: 'array',
        items: 'number',
        populate(ctx: Context, _values: any, responses: any[]) {
          return Promise.all(
            responses.map(async (response) => {
              const questions: Question<'options'>[] = await ctx.call('questions.resolve', {
                id: response.questions,
                populate: 'options',
              });

              const { values: prevValues } = await this.resolveEntities(ctx, {
                id: response.id,
                fields: 'values',
              });

              return questions
                .map(({ dynamicFields, ...question }) => {
                  if (dynamicFields) {
                    dynamicFields.forEach((df) => {
                      if (prevValues[df.condition.question] === df.condition.value) {
                        const values = df.values;

                        if (Array.isArray(values.options)) {
                          // @ts-ignore
                          values.options = values.options
                            .filter((id) => question.options.find((o) => o.id === id))
                            .map((id) => question.options.find((o) => o.id === id));
                        }

                        // @ts-ignore
                        question = {
                          ...question,
                          ...values,
                        };
                      }
                    });
                  }

                  return question;
                })
                .filter((question) => (question.condition as any) !== false)
                .sort((a, b) => b.priority - a.priority);
            }),
          );
        },
      },

      values: {
        type: 'object',
        async set({ value, entity }: FieldHookCallback) {
          if (!value) return value;

          // filter out other page values
          return Object.keys(value)
            .filter((key) => entity.questions.includes(Number(key)))
            .reduce(
              (obj, key) => ({
                ...obj,
                [key]: value[key],
              }),
              {},
            );
        },
        async get({ ctx, entity, value }: FieldHookCallback) {
          if (entity.previousResponseId) {
            const { values: prevValues } = await this.resolveEntities(ctx, {
              id: entity.previousResponseId,
              fields: 'values',
            });

            return {
              ...prevValues,
              ...value,
            };
          }

          return value;
        },
        async onCreate({
          ctx,
          value,
          params,
        }: {
          ctx: Context;
          value: Response['values'];
          params: Partial<Response>;
        }) {
          if (value) {
            return value;
          }

          value = {};

          if (params.questions?.length && params.page && params.session) {
            const session: Session = await ctx.call('sessions.resolve', {
              id: params.session,
            });

            if (session?.auth) {
              const page: Page<'questions'> = await ctx.call('pages.resolve', {
                id: params.page,
                populate: 'questions',
              });

              for (const qId of params.questions) {
                const question = page.questions.find((q) => q.id === qId);

                if (question.authRelation) {
                  if (question.authRelation) {
                    switch (question.authRelation) {
                      case AuthRelation.EMAIL:
                        value[question.id] = session.email;
                        break;

                      case AuthRelation.PHONE:
                        value[question.id] = session.phone;
                        break;
                    }
                  }
                }
              }
            }
          }

          return value;
        },
      },

      progress: {
        type: 'object',
        properties: {
          current: 'number',
          total: 'number',
        },
        async set({ ctx, params }: { ctx: Context; params: Partial<Response> }) {
          let skipAuthQuestions = false;
          let sessionId: Session['id'] = params.session;

          if (!sessionId && params.id) {
            const entity: Response = await this.resolveEntities(ctx, { id: params.id });
            sessionId = entity.session;
          }

          if (sessionId) {
            const session: Session = await ctx.call('sessions.resolve', { id: sessionId });
            skipAuthQuestions = !session.auth;
          }

          if (params.questions) {
            let current = 1;
            if (params.previousResponse) {
              const previousResponse: Response = await ctx.call('responses.resolve', {
                id: params.previousResponse,
              });

              current = previousResponse.progress.current + 1;
            }

            let total = current - 1;
            let startingQuestions = params.questions;

            do {
              total++;

              const { nextPageQuestions }: TraverseGraphResponse =
                await this.actions.traverseQuestionsGraph({
                  startingQuestions,
                  skipAuthQuestions,
                });

              startingQuestions = nextPageQuestions;
            } while (startingQuestions.length && total < 999);

            return { current, total };
          }
        },
      },

      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,

      async session(q: any, ctx: Context<unknown, MetaSession>) {
        if (!ctx?.meta?.session) return q;

        return {
          ...q,
          session: ctx.meta.session.id,
        };
      },
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES, 'session'],
  },
  actions: {
    get: {
      rest: 'GET /:id',
      auth: RestrictionType.SESSION,
    },
  },
})
export default class ResponsesService extends moleculer.Service {
  @Action({
    rest: 'POST /:id/respond',
    auth: RestrictionType.SESSION,
    params: {
      id: 'number|convert',
      values: {
        type: 'record',
        key: 'number|convert',
        value: 'any',
      },
    },
  })
  async respond(ctx: Context<{ id: Response['id']; values: Response['values'] }>) {
    const response: Response<'questions' | 'session'> = await this.resolveEntities(
      ctx,
      {
        id: ctx.params.id,
        populate: 'questions,session',
      },
      {
        throwIfNotExist: true,
      },
    );

    const { values } = ctx.params;
    const errors: Record<string | number, string> = {};

    for (const question of response.questions) {
      const value = values[question.id];

      if (!value) {
        const conditions = Array.isArray(question.condition)
          ? question.condition
          : question.condition
          ? [question.condition]
          : null;

        if (question.required && (!conditions.length || this.checkConditions(conditions, values))) {
          errors[question.id] = 'REQUIRED';
        }

        continue;
      }

      let option: QuestionOption;

      switch (question.type) {
        case QuestionType.RADIO:
        case QuestionType.INFOCARD:
        // case QuestionType.ADDRESS:
        case QuestionType.SELECT:
          option = question.options.find((o) => o.id === value);

          if (!option) {
            errors[question.id] = 'OPTION: ' + question.options.map((o) => o.id).join(', ');
            break;
          }

          break;

        case QuestionType.CHECKBOX:
          if (typeof value !== 'boolean') {
            errors[question.id] = 'BOOLEAN';
          }

          break;

        case QuestionType.MULTISELECT:
          if (!Array.isArray(value)) {
            errors[question.id] = 'ARRAY: ' + question.options.map((o) => o.id).join(', ');
          } else {
            for (const item of value) {
              option = question.options.find((o) => o.id === item);

              if (!option) {
                errors[question.id] = 'OPTION: ' + question.options.map((o) => o.id).join(', ');
                break;
              }
            }
          }

          break;

        case QuestionType.FILES:
          if (!Array.isArray(value)) {
            errors[question.id] = 'FILES must be array';
          } else {
            for (const item of value) {
              if (!item.url) {
                errors[question.id] = 'FILES item must have url property';
              }
            }
          }

          break;

        case QuestionType.EMAIL:
          if (
            !/^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|.(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(
              String(value).toLowerCase(),
            )
          ) {
            errors[question.id] = 'EMAIL';
          }
          break;

        case QuestionType.LOCATION:
          if (!value?.features?.[0]?.geometry?.coordinates) {
            errors[question.id] = 'LOCATION';
          }
          break;
      }
    }

    if (Object.keys(errors).length) {
      return { errors };
    }

    const { nextPageQuestions }: TraverseGraphResponse = await this.actions.traverseQuestionsGraph({
      startingQuestions: response.questions.map((q) => q.id),
      values,
    });

    let questions: Array<Question['id']> = [];
    let page: Page['id'];

    if (nextPageQuestions.length) {
      ({ questions, page } = await this.actions.traverseQuestionsGraph({
        startingQuestions: nextPageQuestions,
        skipAuthQuestions: !response.session.auth,
      }));
    }

    await this.updateEntity(ctx, {
      id: response.id,
      values,
    });

    if (!questions.length || !page) {
      await ctx.call('sessions.finish', {
        id: response.session.id,
      });

      return {
        nextResponse: null,
      };
    }

    let nextResponse: Response = await this.findEntity(ctx, {
      query: {
        session: response.session.id,
        page,
      },
    });

    if (!nextResponse) {
      nextResponse = await this.createEntity(ctx, {
        session: response.session.id,
        page,
        questions,
        previousResponse: response.id,
      });
    } else {
      await this.updateEntity(ctx, {
        id: nextResponse.id,
        questions,
        previousResponse: response.id,
      });
    }

    await ctx.call('sessions.update', {
      id: response.session.id,
      lastResponse: nextResponse.id,
    });

    return {
      nextResponse: nextResponse.id,
    };
  }

  /**
   * Usecases:
   * 1) responding to page questions. Questions of the next page needed, depending on provided values.
   * 2) estimating progress of the page. Giving current page with relevant questions we need to estimate next pages possible.
   * 3) starting session usually is simple - all questions of the first page.
   *    However, in case of auth=false we eliminate all auth questions and page migth get empty, this method helps detecting next page.
   */
  @Action({
    params: {
      startingQuestions: {
        type: 'array',
        items: 'number',
      },
      values: 'object|optional',
      skipAuthQuestions: 'boolean|optional',
    },
  })
  async traverseQuestionsGraph(
    ctx: Context<{
      startingQuestions: Array<Question['id']>;
      values?: Response['values'];
      skipAuthQuestions?: boolean;
    }>,
  ) {
    const { startingQuestions, values, skipAuthQuestions } = ctx.params;

    // startingQuestions should be from the same page, we do not handle cases when it's not
    const question: Question = await ctx.call('questions.resolve', { id: startingQuestions[0] });
    const pageId = question.page;

    const page: Page<'questions'> = await ctx.call('pages.resolve', {
      id: pageId,
      populate: 'questions',
    });

    const pageQuestions = this.traversePageQuestions(startingQuestions, page.questions, values);

    const nextPageQuestions = pageQuestions.nextPageQuestions;
    let questions = pageQuestions.questions;

    if (skipAuthQuestions) {
      questions = questions.filter((questionId) => {
        const question = page.questions.find((q) => q.id === questionId);

        if (!question) return false;
        if (question.authRelation) return false;
        return true;
      });
    }

    if (!questions.length && nextPageQuestions.length) {
      return this.actions.traverseQuestionsGraph({
        startingQuestions: nextPageQuestions,
        values,
        skipAuthQuestions,
      });
    }

    return { questions, nextPageQuestions, page: pageId };
  }

  @Method
  traversePageQuestions(
    startingQuestions: Array<Question['id']>,
    localQuestions: Array<Question<'options'>>,
    values?: Response['values'],
  ) {
    const questions = new Set<Question['id']>();
    const nextPageQuestions = new Set<Question['id']>();

    const handle = (questionId?: Question['id']) => {
      if (!questionId) return;

      const local = localQuestions.find((q) => q.id === questionId);

      // skip question if conditional and does not satisfy condition (only when values provided)
      if (values && local && local.condition) {
        const conditions = Array.isArray(local.condition) ? local.condition : [local.condition];

        if (!this.checkConditions(conditions, values)) {
          return;
        }
      }

      if (local) {
        questions.add(questionId);

        // call recursion with nextQuestion on current
        handle(local.nextQuestion);

        // if question with options, continue nextQuestion by option
        if (
          [
            QuestionType.SELECT,
            QuestionType.MULTISELECT,
            QuestionType.RADIO,
            QuestionType.INFOCARD,
            QuestionType.ADDRESS,
          ].includes(local.type)
        ) {
          if (!values) {
            // if no values provided - continue recursion with all options nextQuestion
            local.options?.forEach((option) => handle(option.nextQuestion));
          } else if (values[local.id]) {
            if (QuestionType.MULTISELECT === local.type) {
              // for multiselect continue recursion with all values selected
              local.options
                .filter((option) => values[local.id]?.includes(option.id))
                .forEach((option) => handle(option.nextQuestion));
            } else {
              // if values provided - continue recursion with selected option
              handle(local.options.find((option) => option.id === values[local.id])?.nextQuestion);
            }
          }
        }
      } else {
        nextPageQuestions.add(questionId);
      }
    };

    startingQuestions.forEach(handle);

    return {
      questions: [...questions].sort((a, b) => {
        const aQuestion = localQuestions.find((q) => q.id === a);
        const bQuestion = localQuestions.find((q) => q.id === b);
        return bQuestion.priority - aQuestion.priority;
      }),
      nextPageQuestions: [...nextPageQuestions],
    };
  }
  @Method
  checkConditions(conditions: any[], values: Record<string | number, any>): boolean {
    if (!conditions || conditions.length === 0) return true;

    return conditions.every((condition) => {
      const responseValue = values[condition.question];
      return responseValue === condition.value || responseValue?.includes?.(condition.value);
    });
  }

  @Method
  async checkScopeAuthority(
    _ctx: Context<unknown, MetaSession>,
    scopeName: string,
    operation: 'add' | 'remove',
  ) {
    if (scopeName === 'session') {
      // do NOT allow to remove the scope
      if (operation === 'remove') {
        return false;
      }
    }

    // Allow add/remove other scopes by default and by request
    return true;
  }
}
