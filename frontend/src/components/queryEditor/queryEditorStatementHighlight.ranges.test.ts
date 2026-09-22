import { describe, expect, it } from 'vitest';

import {
  findHighlightableStatementRanges,
  padOverlayRect,
  resolveExecutionSqlHighlightRange,
  resolveHighlightableRangeFromRanges,
  resolveHighlightableStatementRange,
} from './queryEditorStatementHighlight';

describe('findHighlightableStatementRanges', () => {
  it('includes ASCII and full-width statement delimiters', () => {
    const sql = 'SELECT 1；\nSELECT 2;';
    expect(findHighlightableStatementRanges(sql, 'mysql').map((range) => range.text)).toEqual([
      'SELECT 1；',
      'SELECT 2;',
    ]);
  });

  it('normalizes CRLF before splitting ranges', () => {
    const sql = 'SELECT 1;\r\nSELECT 2;';
    const ranges = findHighlightableStatementRanges(sql, 'mysql');
    expect(ranges.map((range) => range.text)).toEqual(['SELECT 1;', 'SELECT 2;']);
    expect(ranges[1].start).toBe('SELECT 1;\n'.length);
  });

  it('does not split on semicolons inside strings or comments', () => {
    const sql = [
      "SELECT ';' AS semi;",
      '-- comment ; still comment',
      "SELECT 'a; b' AS text;",
    ].join('\n');
    expect(findHighlightableStatementRanges(sql, 'mysql').map((range) => range.text)).toEqual([
      "SELECT ';' AS semi;",
      "-- comment ; still comment\nSELECT 'a; b' AS text;",
    ]);
  });

  it('keeps SQL Server escaped bracket identifiers intact', () => {
    const sql = 'SELECT * FROM [a]];b]; SELECT 2;';
    expect(findHighlightableStatementRanges(sql, 'sqlserver').map((range) => range.text)).toEqual([
      'SELECT * FROM [a]];b];',
      'SELECT 2;',
    ]);
  });

  it('still splits on a raw semicolon inside unescaped SQL Server brackets', () => {
    expect(findHighlightableStatementRanges('SELECT * FROM [a];b]; SELECT 2;', 'sqlserver').map((range) => range.text)).toEqual([
      'SELECT * FROM [a];',
      'b];',
      'SELECT 2;',
    ]);
  });

  it('returns an empty list for blank or comment-only input', () => {
    expect(findHighlightableStatementRanges('   \n\t', 'mysql')).toEqual([]);
    expect(findHighlightableStatementRanges('-- only comment\n/* block */', 'postgres')).toEqual([]);
  });
});

describe('resolveHighlightableStatementRange edge cases', () => {
  it('attaches a caret on a blank line to the following statement', () => {
    const sql = 'SELECT 1;\n\nSELECT 2;';
    const blankLineOffset = sql.indexOf('\n\n') + 1;
    expect(resolveHighlightableStatementRange(sql, blankLineOffset, 'mysql')?.text).toBe('SELECT 2;');
  });

  it('keeps a caret after a full-width semicolon on the previous statement', () => {
    const sql = 'SELECT 1；\nSELECT 2;';
    expect(resolveHighlightableStatementRange(sql, 'SELECT 1；'.length, 'mysql')?.text).toBe('SELECT 1；');
  });

  it('resolves the last statement when the caret is past the end', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    expect(resolveHighlightableStatementRange(sql, 10_000, 'mysql')?.text).toBe('SELECT 2;');
  });

  it('treats NaN offsets as the start of the script', () => {
    const sql = 'SELECT 1;\nSELECT 2;';
    const ranges = findHighlightableStatementRanges(sql, 'mysql');
    expect(resolveHighlightableRangeFromRanges(sql, ranges, Number.NaN)?.text).toBe('SELECT 1;');
    expect(resolveHighlightableRangeFromRanges(sql, [], 0)).toBeNull();
  });

  it('keeps a caret on an Oracle slash line with the block above it', () => {
    const sql = 'BEGIN\n  NULL;\nEND;\n/ \nSELECT 2;';
    const slashOffset = sql.indexOf('/ ');
    const spaceAfterSlash = slashOffset + 1;
    const selectOffset = sql.indexOf('SELECT 2');
    const statement = resolveHighlightableStatementRange(sql, spaceAfterSlash, 'oracle');
    const ranges = findHighlightableStatementRanges(sql, 'oracle');

    expect(statement?.text).toBe('BEGIN\n  NULL;\nEND;');
    expect(resolveHighlightableRangeFromRanges(sql, ranges, slashOffset)?.text).toBe(statement?.text);
    expect(resolveHighlightableRangeFromRanges(sql, ranges, spaceAfterSlash)?.text).toBe(statement?.text);
    expect(resolveHighlightableRangeFromRanges(sql, ranges, selectOffset)?.text).toBe('SELECT 2;');
  });

  it('frames the block above a slash when that block is what will run', () => {
    const sql = 'BEGIN\n  NULL;\nEND;\n/\nSELECT 2;';
    const slashOffset = sql.indexOf('\n/\n') + 1;
    expect(resolveExecutionSqlHighlightRange(sql, 'BEGIN\n  NULL;\nEND;', slashOffset, 'oracle')?.text)
      .toBe('BEGIN\n  NULL;\nEND;');
  });
});

describe('resolveExecutionSqlHighlightRange edge cases', () => {
  it('keeps the cursor copy when the same statement appears twice', () => {
    const repeated = 'UPDATE logs SET id = 2;';
    const sql = `${repeated}\nSELECT 1;\n${repeated}`;
    const range = resolveExecutionSqlHighlightRange(sql, repeated, 2, 'mysql');
    expect(range?.start).toBe(0);
    expect(range?.text).toBe(repeated);
  });

  it('strips leading whitespace from appended execution SQL', () => {
    const sql = 'SELECT 1;\n  INSERT INTO t VALUES (1);';
    const range = resolveExecutionSqlHighlightRange(
      sql,
      '\n  INSERT INTO t VALUES (1);',
      2,
      'mysql',
    );
    expect(range?.text).toBe('INSERT INTO t VALUES (1);');
  });

  it('falls back to a trimmed substring when the raw execution SQL is not present', () => {
    const sql = 'SELECT 1;\n  SELECT 2;  ';
    const range = resolveExecutionSqlHighlightRange(sql, '  SELECT 2;  ', 0, 'mysql');
    expect(range?.text).toBe('SELECT 2;');
  });

  it('returns null for whitespace-only execution SQL', () => {
    expect(resolveExecutionSqlHighlightRange('SELECT 1;', '   \n', 0, 'mysql')).toBeNull();
  });

  it('frames a selection that spans multiple statements', () => {
    const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
    const selected = 'SELECT 1;\nSELECT 2;';
    const range = resolveExecutionSqlHighlightRange(sql, selected, sql.length, 'mysql');
    expect(range?.text).toBe(selected);
  });
});

describe('padOverlayRect', () => {
  it('expands a rectangle equally on all sides', () => {
    expect(padOverlayRect({ left: 10, top: 20, width: 30, height: 12 }, 4)).toEqual({
      left: 6,
      top: 16,
      width: 38,
      height: 20,
    });
  });
});
