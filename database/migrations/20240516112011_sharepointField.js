const { schema } = require('../common');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .withSchema(schema)
    .alterTable('surveys', (table) => {
      table.string('spList');
    })
    .alterTable('questions', (table) => {
      table.string('spField');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .withSchema(schema)
    .alterTable('surveys', (table) => {
      table.dropColumn('spList');
    })
    .alterTable('questions', (table) => {
      table.dropColumn('spField');
    });
};
