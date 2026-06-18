const { schema } = require('../common');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .withSchema(schema)
    .createTable('authTokens', (table) => {
      table.increments('id');
      table.string('tokenHash').notNullable();
      table.uuid('userId').notNullable();
      table.string('email');
      table.string('phone');
      table.timestamp('expiresAt').notNullable();
      table.timestamp('createdAt');
      table.timestamp('updatedAt');
      table.timestamp('deletedAt');
      table.index(['tokenHash']);
      table.index(['userId']);
      table.index(['expiresAt']);
    })
    .alterTable('sessions', (table) => {
      table.uuid('userId');
      table.index(['userId']);
    })
    .alterTable('reports', (table) => {
      table.string('status').notNullable().defaultTo('SUBMITTED');
      table.string('externalId');
      table.timestamp('statusUpdatedAt');
      table.text('statusMessage');
      table.index(['sessionId']);
      table.index(['status']);
      table.index(['externalId']);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .withSchema(schema)
    .alterTable('reports', (table) => {
      table.dropIndex(['externalId']);
      table.dropIndex(['status']);
      table.dropIndex(['sessionId']);
      table.dropColumn('statusMessage');
      table.dropColumn('statusUpdatedAt');
      table.dropColumn('externalId');
      table.dropColumn('status');
    })
    .alterTable('sessions', (table) => {
      table.dropIndex(['userId']);
      table.dropColumn('userId');
    })
    .dropTable('authTokens');
};
