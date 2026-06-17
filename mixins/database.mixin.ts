'use strict';

import _ from 'lodash';
const DbService = require('@moleculer/database').Service;
import config from '../knexfile';
import filtersMixin from 'moleculer-knex-filters';
import { Context } from 'moleculer';

function makeMapping(
  data: any[],
  mapping?: string,
  options?: {
    mappingMulti?: boolean;
    mappingField?: string;
  },
) {
  if (!mapping) return data;

  return data?.reduce((acc: any, item) => {
    let value: any = item;

    if (options?.mappingField) {
      value = item[options.mappingField];
    }

    if (options?.mappingMulti) {
      return {
        ...acc,
        [`${item[mapping]}`]: [...(acc[`${item[mapping]}`] || []), value],
      };
    }

    return { ...acc, [`${item[mapping]}`]: value };
  }, {});
}

export default function (opts: any = {}) {
  const adapter: any = {
    type: 'Knex',
    options: {
      knex: config,
      tableName: opts.collection,
      schema: opts.schema || process.env.DB_SCHEMA,
    },
  };

  const cache = {
    enabled: false,
  };

  opts = _.defaultsDeep(opts, { adapter }, { cache: opts.cache || cache });

  const removeRestActions: any = {};

  if (opts?.createActions === undefined || opts?.createActions !== false) {
    removeRestActions.replace = {
      rest: null as any,
    };
  }

  const schema = {
    mixins: [DbService(opts), filtersMixin()],

    async started(this: any) {
      await this.getAdapter();
      // Seeding if the DB is empty
      const count = await this.countEntities(null, {});
      if (count == 0 && _.isFunction(this.seedDB)) {
        this.logger.info(`Seed '${opts.collection}' collection...`);
        await this.seedDB();
      }
    },

    actions: {
      ...removeRestActions,

      async findOne(ctx: any) {
        const result: any[] = await ctx.call(`${this.name}.find`, ctx.params);
        if (result.length) return result[0];
        return;
      },

      async removeAllEntities(ctx: any) {
        return await this.clearEntities(ctx);
      },

      async populateByProp(
        ctx: Context<{
          id: number | number[];
          queryKey: string;
          query: any;
          mapping?: boolean;
          mappingMulti?: boolean;
          mappingField: string;
        }>,
      ): Promise<any> {
        const { id, queryKey, query, mapping, mappingMulti, mappingField } = ctx.params;

        const queryParams = ctx.params as Partial<typeof ctx.params>;
        delete queryParams.queryKey;
        delete queryParams.id;
        delete queryParams.mapping;
        delete queryParams.mappingMulti;
        delete queryParams.mappingField;

        const entities = await this.findEntities(ctx, {
          ...ctx.params,
          query: {
            ...(query || {}),
            [queryKey]: { $in: id },
          },
        });

        return makeMapping(entities, mapping ? queryKey : '', {
          mappingMulti,
          mappingField: mappingField,
        });
      },
    },

    methods: {
      filterQueryIds(ids: number[], queryIds?: any) {
        if (!queryIds) return ids;

        queryIds = (Array.isArray(queryIds) ? queryIds : [queryIds]).map((id: any) => parseInt(id));

        return ids.filter((id) => queryIds.indexOf(id) >= 0);
      },
    },

    hooks: {
      before: {
        find: 'applyFilterFunction',
        list: 'applyFilterFunction',
      },
      after: {
        find: [
          async function (
            ctx: Context<{
              mapping: string;
              mappingMulti: boolean;
              mappingField: string;
            }>,
            data: any[],
          ) {
            const { mapping, mappingMulti, mappingField } = ctx.params;
            return makeMapping(data, mapping, {
              mappingMulti,
              mappingField,
            });
          },
        ],
      },
    },

    merged(schema: any) {
      if (schema.actions) {
        for (const action in schema.actions) {
          const params = schema.actions[action].additionalParams;
          if (typeof params === 'object') {
            schema.actions[action].params = {
              ...schema.actions[action].params,
              ...params,
            };
          }
        }
      }
    },
  };

  return schema;
}
