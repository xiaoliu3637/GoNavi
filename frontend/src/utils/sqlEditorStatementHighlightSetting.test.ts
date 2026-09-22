import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CONFIRM_SQL_STATEMENT_RUN,
  DEFAULT_HIGHLIGHT_CURRENT_SQL_STATEMENT,
  sanitizeConfirmSqlStatementRun,
  sanitizeHighlightCurrentSqlStatement,
} from './sqlEditorStatementHighlightSetting';

describe('sanitizeHighlightCurrentSqlStatement', () => {
  it('defaults to on when the persisted value is missing', () => {
    expect(DEFAULT_HIGHLIGHT_CURRENT_SQL_STATEMENT).toBe(true);
    expect(sanitizeHighlightCurrentSqlStatement(undefined)).toBe(true);
    expect(sanitizeHighlightCurrentSqlStatement(null)).toBe(true);
  });

  it('preserves an explicit boolean', () => {
    expect(sanitizeHighlightCurrentSqlStatement(false)).toBe(false);
    expect(sanitizeHighlightCurrentSqlStatement(true)).toBe(true);
  });

  it('rejects non-boolean persisted values', () => {
    expect(sanitizeHighlightCurrentSqlStatement('false')).toBe(true);
    expect(sanitizeHighlightCurrentSqlStatement(0)).toBe(true);
    expect(sanitizeHighlightCurrentSqlStatement({ enabled: false })).toBe(true);
  });
});

describe('sanitizeConfirmSqlStatementRun', () => {
  it('defaults to off when the persisted value is missing', () => {
    expect(DEFAULT_CONFIRM_SQL_STATEMENT_RUN).toBe(false);
    expect(sanitizeConfirmSqlStatementRun(undefined)).toBe(false);
    expect(sanitizeConfirmSqlStatementRun(null)).toBe(false);
  });

  it('preserves an explicit boolean', () => {
    expect(sanitizeConfirmSqlStatementRun(true)).toBe(true);
    expect(sanitizeConfirmSqlStatementRun(false)).toBe(false);
  });

  it('rejects non-boolean persisted values', () => {
    expect(sanitizeConfirmSqlStatementRun('true')).toBe(false);
    expect(sanitizeConfirmSqlStatementRun(1)).toBe(false);
  });
});
