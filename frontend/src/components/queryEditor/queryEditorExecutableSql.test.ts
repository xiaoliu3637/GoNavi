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
});
