'use strict';

import moleculer, { Context } from 'moleculer';
import { Service } from 'moleculer-decorators';
import DbConnection from '../mixins/database.mixin';

import {
  CommonFields,
  CommonPopulates,
  COMMON_DEFAULT_SCOPES,
  COMMON_FIELDS,
  COMMON_SCOPES,
  Table,
  DynamicFields,
  DYNAMIC_FIELDS,
} from '../types';
import { Question } from './questions.service';

interface Fields extends CommonFields {
  title: string;
  description: string;
  questions: undefined;
  dynamicFields: DynamicFields<Page>;
}

interface Populates extends CommonPopulates {
  questions: Array<Question<'options'>>;
}

export type Page<
  P extends keyof Populates = never,
  F extends keyof Fields | keyof Populates = keyof Fields,
> = Table<Fields, Populates, P, F>;

@Service({
  name: 'pages',
  mixins: [
    DbConnection({
      collection: 'pages',
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

      title: 'string',
      description: 'string',

      questions: {
        type: 'array',
        virtual: true,
        async populate(ctx: Context, _values: number[], entities: Question[]) {
          const questions: Array<Question<'options'>> = await ctx.call('questions.find', {
            query: {
              page: { $in: entities.map((e) => e.id) },
            },
            populate: 'options',
            sort: '-priority',
          });

          return entities.map((entity) =>
            questions.filter((question) => question.page === entity.id),
          );
        },
      },

      ...DYNAMIC_FIELDS,
      ...COMMON_FIELDS,
    },

    scopes: {
      ...COMMON_SCOPES,
    },

    defaultScopes: [...COMMON_DEFAULT_SCOPES],
  },
})
export default class PagesService extends moleculer.Service {}
