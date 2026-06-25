const { schema } = require('../common');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.withSchema(schema).dropTable('authTokens');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.withSchema(schema).createTable('authTokens', (table) => {
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
  });
};
