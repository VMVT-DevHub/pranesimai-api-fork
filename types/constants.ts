import _ from 'lodash';
import { Question } from '../services/questions.service';

export enum EndpointType {
  PUBLIC = 'PUBLIC',
  ADMIN = 'ADMIN',
  USER = 'USER',
  SELF = 'SELF',
}

export enum UserType {
  ADMIN = 'ADMIN',
  USER = 'USER',
}

export const SESSION_MAX_AGE_SECONDS = 60 * 30;

export function queryBoolean(field: string, value: boolean = false) {
  let fieldValue = `${_.snakeCase(field)} IS`;
  if (!value) {
    fieldValue += ' NOT';
  }
  return { $raw: `${fieldValue} TRUE` };
}

export type DynamicFields<T> = Array<{
  condition: {
    question: Question['id'];
    value: any;
  };
  values: Partial<T>;
}>;

export const DYNAMIC_FIELDS = {
  dynamicFields: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        condition: 'any',
        values: {
          type: 'record',
          key: 'string',
          value: 'any',
        },
      },
    },
  },
};

export const COMMON_FIELDS = {
  createdAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onCreate: () => new Date(),
  },

  updatedAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onUpdate: () => new Date(),
  },

  deletedAt: {
    type: 'date',
    columnType: 'datetime',
    readonly: true,
    onRemove: () => new Date(),
  },
};

export const COMMON_HIDDEN_FIELDS = _.merge(COMMON_FIELDS, {
  deletedBy: {
    hidden: 'byDefault',
  },
  deletedAt: {
    hidden: 'byDefault',
  },
  updatedAt: {
    hidden: 'byDefault',
  },
  updatedBy: {
    hidden: 'byDefault',
  },
});

export const COMMON_SCOPES = {
  notDeleted: {
    deletedAt: { $exists: false },
  },
  deleted: {
    deletedAt: { $exists: true },
  },
};

export const COMMON_DEFAULT_SCOPES = ['notDeleted'];
export const COMMON_DELETED_SCOPES = ['-notDeleted', 'deleted'];
