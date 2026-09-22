import { describe, expect, it } from 'vitest';

import { resolveQueryEditorExecutableSql } from './queryEditorExecutableSql';

const createEditor = (
  sql: string,
  position = { lineNumber: 1, column: 1 },
  selectedSql = '',
) => ({
  getModel: () => ({
    getValue: () => sql,
  }),
  getPosition: () => position,
  getSelection: () => ({
    isEmpty: () => !selectedSql,
    lineNumber: position.lineNumber,
    column: position.column,
  }),
});

describe('resolveQueryEditorExecutableSql', () => {
  it('prefers an explicit selection', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(resolveQueryEditorExecutableSql({
      editor: createEditor(sql, { lineNumber: 2, column: 1 }, 'SELECT 1'),
      currentQuery: sql,
      selectedSql: 'SELECT 1',
      resultSetCount: 0,
      lastExecutedQuery: '',
      cachedPosition: null,
      dbType: 'mysql',
    })).toBe('SELECT 1');
  });

  it('returns the complete appended region after an earlier execution', () => {
    const executed = 'SELECT 1;';
    const appended = '\nINSERT INTO logs VALUES (1);\nUPDATE logs SET id = 2;';
    const sql = executed + appended;

    expect(resolveQueryEditorExecutableSql({
      editor: createEditor(sql),
      currentQuery: sql,
      selectedSql: '',
      resultSetCount: 1,
      lastExecutedQuery: executed,
      cachedPosition: null,
      dbType: 'mysql',
    })).toBe(appended);
  });

  it('resolves the statement at the cached editor position', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(resolveQueryEditorExecutableSql({
      editor: {
        getModel: () => ({ getValue: () => sql }),
        getPosition: () => ({ lineNumber: 1, column: 1 }),
      },
      currentQuery: sql,
      selectedSql: '',
      resultSetCount: 0,
      lastExecutedQuery: '',
      cachedPosition: { lineNumber: 2, column: 3 },
      dbType: 'mysql',
    })).toBe('SELECT 2');
  });

  it('falls back to the current query when the editor is missing', () => {
    expect(resolveQueryEditorExecutableSql({
      editor: null,
      currentQuery: 'SELECT 1;',
      selectedSql: '',
      resultSetCount: 0,
      lastExecutedQuery: '',
      cachedPosition: null,
      dbType: 'mysql',
    })).toBe('SELECT 1;');
  });

  it('ignores a whitespace-only selection and uses the live caret', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(resolveQueryEditorExecutableSql({
      editor: createEditor(sql, { lineNumber: 2, column: 3 }, '   '),
      currentQuery: sql,
      selectedSql: '   ',
      resultSetCount: 0,
      lastExecutedQuery: '',
      cachedPosition: { lineNumber: 1, column: 1 },
      dbType: 'mysql',
    })).toBe('SELECT 2');
  });

  it('does not treat trailing whitespace after a previous run as new SQL', () => {
    const executed = 'SELECT 1;';
    const sql = `${executed}\n   `;
    expect(resolveQueryEditorExecutableSql({
      editor: createEditor(sql, { lineNumber: 1, column: 1 }),
      currentQuery: sql,
      selectedSql: '',
      resultSetCount: 1,
      lastExecutedQuery: executed,
      cachedPosition: null,
      dbType: 'mysql',
    })).toBe('SELECT 1');
  });

  it('prefers an explicit selection over SQL appended after the previous run', () => {
    const executed = 'SELECT 1;';
    const sql = `${executed}\nSELECT 2;`;
    expect(resolveQueryEditorExecutableSql({
      editor: createEditor(sql, { lineNumber: 1, column: 1 }, 'SELECT 2'),
      currentQuery: sql,
      selectedSql: 'SELECT 2',
      resultSetCount: 1,
      lastExecutedQuery: executed,
      cachedPosition: null,
      dbType: 'mysql',
    })).toBe('SELECT 2');
  });

  it('ignores an appended region until a result set exists', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(resolveQueryEditorExecutableSql({
      editor: createEditor(sql, { lineNumber: 1, column: 1 }),
      currentQuery: sql,
      selectedSql: '',
      resultSetCount: 0,
      lastExecutedQuery: 'SELECT 1;',
      cachedPosition: null,
      dbType: 'mysql',
    })).toBe('SELECT 1');
  });

  it('returns the selection when the editor model is missing', () => {
    expect(resolveQueryEditorExecutableSql({
      editor: { getModel: () => null },
      currentQuery: 'SELECT 1;',
      selectedSql: 'SELECT 2',
      resultSetCount: 0,
      lastExecutedQuery: '',
      cachedPosition: null,
      dbType: 'mysql',
    })).toBe('SELECT 2');
  });

  it('skips an invalid cached caret and uses the live caret', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(resolveQueryEditorExecutableSql({
      editor: {
        getModel: () => ({ getValue: () => sql }),
        getPosition: () => ({ lineNumber: 2, column: 1 }),
        getSelection: () => null,
      },
      currentQuery: sql,
      selectedSql: '',
      resultSetCount: 0,
      lastExecutedQuery: '',
      cachedPosition: { lineNumber: 0, column: 1 },
      dbType: 'mysql',
    })).toBe('SELECT 2');
  });

  it('prefers the live empty selection over a stale cached caret', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(resolveQueryEditorExecutableSql({
      editor: createEditor(sql, { lineNumber: 2, column: 1 }),
      currentQuery: sql,
      selectedSql: '',
      resultSetCount: 0,
      lastExecutedQuery: '',
      cachedPosition: { lineNumber: 1, column: 1 },
      dbType: 'mysql',
    })).toBe('SELECT 2');
  });
});
