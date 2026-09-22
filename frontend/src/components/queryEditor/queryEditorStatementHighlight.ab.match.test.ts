import { describe, expect, it } from 'vitest';

import { resolveQueryEditorExecutableSql } from './queryEditorExecutableSql';
import {
  buildUnframedExecutionHighlightKey,
  resolveExecutionSqlHighlightRange,
  resolveShortcutStatementKey,
} from './queryEditorStatementHighlight';

type ABPair = {
  id: string;
  scene: string;
  a: { label: string; run: () => unknown; expected: unknown };
  b: { label: string; run: () => unknown; expected: unknown };
};

type HighlightSpan = {
  text: string;
  start: number;
  end: number;
};

const highlightText = (
  sql: string,
  executionSql: string,
  cursor: number,
  dbType = 'mysql',
) => resolveExecutionSqlHighlightRange(sql, executionSql, cursor, dbType)?.text ?? null;

const highlightSpan = (
  sql: string,
  executionSql: string,
  cursor: number,
  dbType = 'mysql',
): HighlightSpan | null => {
  const range = resolveExecutionSqlHighlightRange(sql, executionSql, cursor, dbType);
  if (!range) return null;
  return { text: range.text, start: range.start, end: range.end };
};

const executable = (
  sql: string,
  overrides: Partial<Parameters<typeof resolveQueryEditorExecutableSql>[0]> = {},
) => resolveQueryEditorExecutableSql({
  editor: {
    getModel: () => ({ getValue: () => sql }),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getSelection: () => ({ isEmpty: () => true, lineNumber: 1, column: 1 }),
  },
  currentQuery: sql,
  selectedSql: '',
  resultSetCount: 0,
  lastExecutedQuery: '',
  cachedPosition: null,
  dbType: 'mysql',
  ...overrides,
});

const twoStatements = 'SELECT 1;\nSELECT 2;';
const repeated = 'SELECT 1;\nSELECT 1;';
const threeStatements = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
const statements23 = 'SELECT 2;\nSELECT 3;';
const gapScript = 'SELECT 1;\n\nSELECT 2;';
const gapCursor = 'SELECT 1;\n'.length;
const commented = 'SELECT 1;\n-- note\nSELECT 2;';
const crlfScript = 'SELECT 1;\r\nSELECT 2;';
const bracketScript = 'SELECT * FROM [a]];b]; SELECT 2;';

const pairs: ABPair[] = [
  {
    id: 'M01',
    scene: '首尾空白能框住，大小写不同框不住',
    a: {
      label: '执行 SQL 带首尾空白',
      run: () => highlightText('SELECT 1;', '  SELECT 1;  ', 0),
      expected: 'SELECT 1;',
    },
    b: {
      label: '执行 SQL 大小写不同',
      run: () => highlightText('SELECT 1;', 'select 1', 0),
      expected: null,
    },
  },
  {
    id: 'M02',
    scene: '换行两句能框整段，空格连接框不住',
    a: {
      label: '执行 SQL 保留换行',
      run: () => highlightText(twoStatements, 'SELECT 1;\nSELECT 2;', 0),
      expected: 'SELECT 1;\nSELECT 2;',
    },
    b: {
      label: '换行被改成空格',
      run: () => highlightText(twoStatements, 'SELECT 1; SELECT 2;', 0),
      expected: null,
    },
  },
  {
    id: 'M03',
    scene: '重复语句按光标框中对应那一条',
    a: {
      label: '光标在第一条',
      run: () => highlightSpan(repeated, 'SELECT 1', 0),
      expected: { text: 'SELECT 1;', start: 0, end: 9 },
    },
    b: {
      label: '光标在第二条',
      run: () => highlightSpan(repeated, 'SELECT 1', 'SELECT 1;\n'.length),
      expected: { text: 'SELECT 1;', start: 10, end: 19 },
    },
  },
  {
    id: 'M04',
    scene: '两句整体跨度 vs 光标在第一句时框第二句',
    a: {
      label: '执行 SQL 为两句整体',
      run: () => highlightSpan(twoStatements, 'SELECT 1;\nSELECT 2;', 0),
      expected: { text: 'SELECT 1;\nSELECT 2;', start: 0, end: 19 },
    },
    b: {
      label: '执行 SQL 只是第二句',
      run: () => highlightSpan(twoStatements, 'SELECT 2', 0),
      expected: { text: 'SELECT 2;', start: 10, end: 19 },
    },
  },
  {
    id: 'M05',
    scene: '部分选区框不住，整句选区能框住',
    a: {
      label: '选区只是 1 FROM',
      run: () => highlightText('SELECT 1 FROM t;', '1 FROM', 0),
      expected: null,
    },
    b: {
      label: '选区恰好是整句',
      run: () => highlightText('SELECT 1 FROM t;', 'SELECT 1 FROM t', 0),
      expected: 'SELECT 1 FROM t;',
    },
  },
  {
    id: 'M06',
    scene: 'SELECT 1 能框，SELECT 10 不会前缀命中 SELECT 1',
    a: {
      label: '执行 SELECT 1',
      run: () => highlightText('SELECT 1;', 'SELECT 1', 0),
      expected: 'SELECT 1;',
    },
    b: {
      label: '执行 SELECT 10',
      run: () => highlightText('SELECT 1;', 'SELECT 10', 0),
      expected: null,
    },
  },
  {
    id: 'M07',
    scene: 'CRLF 编辑器：LF 第一句 vs CRLF 两句整体',
    a: {
      label: '执行 SQL 用 LF 的第一句',
      run: () => highlightText(crlfScript, 'SELECT 1;\n', 0),
      expected: 'SELECT 1;',
    },
    b: {
      label: '执行 SQL 用 CRLF 的两句整体',
      run: () => highlightText(crlfScript, 'SELECT 1;\r\nSELECT 2;', 0),
      expected: 'SELECT 1;\nSELECT 2;',
    },
  },
  {
    id: 'M08',
    scene: '全角分号编辑器对 ASCII 分号与全角分号',
    a: {
      label: '执行 SELECT 1;',
      run: () => highlightText('SELECT 1；', 'SELECT 1;', 0),
      expected: 'SELECT 1；',
    },
    b: {
      label: '执行 SELECT 1；',
      run: () => highlightText('SELECT 1；', 'SELECT 1；', 0),
      expected: 'SELECT 1；',
    },
  },
  {
    id: 'M09',
    scene: '空白或仅分号无框 vs DELETE 的 unframed key',
    a: {
      label: '执行 SQL 只有空白和分号',
      run: () => ({
        highlight: highlightText('SELECT 1;', '  ;  ', 0),
        key: buildUnframedExecutionHighlightKey('  ;  '),
      }),
      expected: { highlight: null, key: null },
    },
    b: {
      label: 'DELETE FROM t; 的 unframed key',
      run: () => buildUnframedExecutionHighlightKey('DELETE FROM t;'),
      expected: 'unframed:DELETE FROM t',
    },
  },
  {
    id: 'M10',
    scene: 'NaN 与负数光标都夹到 0',
    a: {
      label: 'NaN 光标按 0 框到第一句',
      run: () => highlightSpan(twoStatements, 'SELECT 1', Number.NaN),
      expected: { text: 'SELECT 1;', start: 0, end: 9 },
    },
    b: {
      label: '负数光标夹到 0 后框到第一句',
      run: () => highlightSpan(twoStatements, 'SELECT 1;', -8),
      expected: { text: 'SELECT 1;', start: 0, end: 9 },
    },
  },
  {
    id: 'M11',
    scene: '句间空白吸附下一条 vs 执行另一句',
    a: {
      label: '执行 SQL 等于空白吸附的那一句',
      run: () => highlightSpan(gapScript, 'SELECT 2', gapCursor),
      expected: { text: 'SELECT 2;', start: 11, end: 20 },
    },
    b: {
      label: '执行 SQL 等于另一句',
      run: () => highlightSpan(gapScript, 'SELECT 1', gapCursor),
      expected: { text: 'SELECT 1;', start: 0, end: 9 },
    },
  },
  {
    id: 'M12',
    scene: '含注释原文切片能框，去掉注释框不住',
    a: {
      label: '执行 SQL 含句间注释',
      run: () => highlightText(commented, commented, 0),
      expected: 'SELECT 1;\n-- note\nSELECT 2;',
    },
    b: {
      label: '去掉注释只保留两条 SQL',
      run: () => highlightText(commented, 'SELECT 1;\nSELECT 2;', 0),
      expected: null,
    },
  },
  {
    id: 'M13',
    scene: '第 2+3 句在光标第 2 句与第 1 句时都框 2+3',
    a: {
      label: '光标在第 2 句内',
      run: () => highlightSpan(threeStatements, statements23, 'SELECT 1;\n'.length),
      expected: { text: 'SELECT 2;\nSELECT 3;', start: 10, end: 29 },
    },
    b: {
      label: '光标在第 1 句，执行 SQL 仍是 2+3',
      run: () => highlightSpan(threeStatements, statements23, 0),
      expected: { text: 'SELECT 2;\nSELECT 3;', start: 10, end: 29 },
    },
  },
  {
    id: 'M14',
    scene: '有框 key 与无框 key 字符串不同',
    a: {
      label: '有 range 时用 start:end:text',
      run: () => resolveShortcutStatementKey({
        range: { start: 0, end: 9, text: 'SELECT 1;' },
        executionSql: 'SELECT 1',
      }),
      expected: '0:9:SELECT 1;',
    },
    b: {
      label: 'range 为 null 时用 unframed',
      run: () => resolveShortcutStatementKey({
        range: null,
        executionSql: 'SELECT 2;',
      }),
      expected: 'unframed:SELECT 2',
    },
  },
  {
    id: 'M15',
    scene: '末尾多一个分号 vs 空格分隔的两句',
    a: {
      label: '执行 SQL 为 SELECT 1;;',
      run: () => highlightText('SELECT 1;', 'SELECT 1;;', 0),
      expected: null,
    },
    b: {
      label: '执行 SQL 为中间有空格的两句',
      run: () => highlightText('SELECT 1;', 'SELECT 1; SELECT 1', 0),
      expected: null,
    },
  },
  {
    id: 'M16',
    scene: 'sqlserver 第二句 vs mysql 同一文本执行 SELECT 2',
    a: {
      label: 'sqlserver 执行第二句',
      run: () => highlightText(bracketScript, 'SELECT 2;', 0, 'sqlserver'),
      expected: 'SELECT 2;',
    },
    b: {
      label: 'mysql 执行 SELECT 2',
      run: () => highlightText(bracketScript, 'SELECT 2', 0, 'mysql'),
      expected: 'SELECT 2;',
    },
  },
  {
    id: 'M17',
    scene: '非空选区 vs 无选区时的光标语句',
    a: {
      label: '有非空 selectedSql',
      run: () => executable(twoStatements, { selectedSql: 'SELECT 2' }),
      expected: 'SELECT 2',
    },
    b: {
      label: '无选区且光标在第一句',
      run: () => executable(twoStatements, { selectedSql: '' }),
      expected: 'SELECT 1',
    },
  },
  {
    id: 'M18',
    scene: '追加片段 vs 非前缀时回到光标语句',
    a: {
      label: 'currentQuery 以 lastExecutedQuery 开头且后面还有 SQL',
      run: () => executable(twoStatements, {
        resultSetCount: 1,
        lastExecutedQuery: 'SELECT 1;',
        currentQuery: twoStatements,
        selectedSql: '',
      }),
      expected: '\nSELECT 2;',
    },
    b: {
      label: 'lastExecutedQuery 不是前缀',
      run: () => executable(twoStatements, {
        resultSetCount: 1,
        lastExecutedQuery: 'DELETE FROM t;',
        currentQuery: twoStatements,
        selectedSql: '',
      }),
      expected: 'SELECT 1',
    },
  },
];

describe('SQL 语句高亮 A/B：执行 SQL 匹配（18 组）', () => {
  it('covers 18 unique pairs', () => {
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(18);
    expect(pairs).toHaveLength(18);
  });

  it.each(pairs)('$id $scene', ({ a, b }) => {
    expect(a.run(), a.label).toEqual(a.expected);
    expect(b.run(), b.label).toEqual(b.expected);
  });
});
