const { commonFields, schema } = require('../common');

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema
    .withSchema(schema)
    .alterTable('questions', (table) => {
      table.dropColumn('type');
    })
    .alterTable('questions', (table) => {
      table
        .enum('type', [
          'DATE',
          'DATETIME',
          'SELECT',
          'MULTISELECT',
          'RADIO',
          'INFOCARD',
          'ADDRESS',
          'EMAIL',
          'INPUT',
          'TEXT',
          'FILES',
          'CHECKBOX',
          'LOCATION',
          'NUMBER',
        ])
        .defaultTo('INPUT');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema
    .withSchema(schema)
    .alterTable('questions', (table) => {
      table.dropColumn('type');
    })
    .alterTable('questions', (table) => {
      table
        .enum('type', [
          'DATE',
          'DATETIME',
          'SELECT',
          'MULTISELECT',
          'RADIO',
          'EMAIL',
          'INPUT',
          'TEXT',
          'FILES',
          'CHECKBOX',
          'LOCATION',
        ])
        .defaultTo('INPUT');
    });
};
