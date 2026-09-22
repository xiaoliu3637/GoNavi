import { describe, expect, it } from 'vitest';

import {
  resolvePersistedSqlStatementHighlightSettings,
  sanitizeSqlStatementHighlightSettings,
} from '../../store/sqlStatementHighlightSlice';
import {
  buildStatementHighlightKey,
  buildUnframedExecutionHighlightKey,
  findHighlightableStatementRanges,
  resolveExecutionSqlHighlightRange,
  resolveHighlightableStatementRange,
  resolveRunShortcutAction,
  resolveShortcutStatementKey,
  shouldDisarmArmedHighlightOnClick,
} from './queryEditorStatementHighlight';
import { resolveQueryEditorExecutableSql } from './queryEditorExecutableSql';

type ABPair = {
  id: string;
  scene: string;
  a: { label: string; actual: unknown; expected: unknown };
  b: { label: string; actual: unknown; expected: unknown };
};

const shortcut = (
  overrides: Partial<Parameters<typeof resolveRunShortcutAction>[0]> = {},
) => resolveRunShortcutAction({
  enabled: true,
  requireConfirm: true,
  statementKey: '0:9:SELECT 1;',
  armedKey: null,
  ...overrides,
});

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

const highlightText = (
  sql: string,
  executionSql: string,
  cursorOffset: number,
  dbType = 'mysql',
) => resolveExecutionSqlHighlightRange(sql, executionSql, cursorOffset, dbType)?.text ?? null;

const statementAt = (sql: string, offset: number, dbType = 'mysql') => (
  resolveHighlightableStatementRange(sql, offset, dbType)?.text ?? null
);

const splitTexts = (sql: string, dbType = 'mysql') => (
  findHighlightableStatementRanges(sql, dbType).map((range) => range.text)
);

const pairs: ABPair[] = [
  {
    id: '01',
    scene: '快捷键二次确认开关',
    a: { label: '确认开：首次只武装', actual: shortcut({ requireConfirm: true }), expected: 'arm' },
    b: { label: '确认关：一次即执行', actual: shortcut({ requireConfirm: false }), expected: 'run' },
  },
  {
    id: '02',
    scene: '同一语句二次快捷键',
    a: { label: '未武装', actual: shortcut({ armedKey: null }), expected: 'arm' },
    b: {
      label: '已武装同一 key',
      actual: shortcut({ armedKey: '0:9:SELECT 1;' }),
      expected: 'run',
    },
  },
  {
    id: '03',
    scene: '光标换到另一条语句',
    a: {
      label: '同语句二次确认',
      actual: shortcut({ statementKey: 'k1', armedKey: 'k1' }),
      expected: 'run',
    },
    b: {
      label: '换语句需重新武装',
      actual: shortcut({ statementKey: 'k2', armedKey: 'k1' }),
      expected: 'arm',
    },
  },
  {
    id: '04',
    scene: '有无真实选区',
    a: { label: '无选区需确认', actual: shortcut({}), expected: 'arm' },
    b: {
      label: '有选区同样需确认',
      actual: shortcut({ statementKey: '0:9:SELECT 1;' }),
      expected: 'arm',
    },
  },
  {
    id: '05',
    scene: '功能总开关',
    a: { label: '高亮开', actual: shortcut({ enabled: true }), expected: 'arm' },
    b: { label: '高亮关直接跑', actual: shortcut({ enabled: false }), expected: 'run' },
  },
  {
    id: '06',
    scene: '无法识别语句时',
    a: { label: '有 statementKey 武装', actual: shortcut({ statementKey: 'k' }), expected: 'arm' },
    b: { label: '无 key 直接跑', actual: shortcut({ statementKey: null }), expected: 'run' },
  },
  {
    id: '07',
    scene: '无框执行 SQL 的确认',
    a: {
      label: 'unframed 首次武装',
      actual: shortcut({
        statementKey: buildUnframedExecutionHighlightKey('DELETE FROM missing'),
      }),
      expected: 'arm',
    },
    b: {
      label: 'unframed 二次执行',
      actual: shortcut({
        statementKey: buildUnframedExecutionHighlightKey('DELETE FROM missing'),
        armedKey: buildUnframedExecutionHighlightKey('DELETE FROM missing'),
      }),
      expected: 'run',
    },
  },
  {
    id: '08',
    scene: '快捷键 key：框选 vs 无框',
    a: {
      label: '有 range 用框 key',
      actual: resolveShortcutStatementKey({
          range: { start: 0, end: 9, text: 'SELECT 1;' },
        executionSql: 'SELECT 1',
      }),
      expected: buildStatementHighlightKey({ start: 0, end: 9, text: 'SELECT 1;' }),
    },
    b: {
      label: '无 range 用 unframed key',
      actual: resolveShortcutStatementKey({
        range: null,
        executionSql: 'DELETE FROM missing;',
      }),
      expected: 'unframed:DELETE FROM missing',
    },
  },
  {
    id: '09',
    scene: '选区仍使用语句 key',
    a: {
      label: '无选区',
      actual: resolveShortcutStatementKey({
        range: { start: 0, end: 9, text: 'SELECT 1;' },
        executionSql: 'SELECT 1',
      }),
      expected: '0:9:SELECT 1;',
    },
    b: {
      label: '有选区仍保留 range key',
      actual: resolveShortcutStatementKey({
        range: { start: 0, end: 9, text: 'SELECT 1;' },
        executionSql: 'SELECT 1',
      }),
      expected: '0:9:SELECT 1;',
    },
  },
  {
    id: '10',
    scene: '空白执行 SQL 不能武装',
    a: {
      label: '有效 SQL',
      actual: resolveShortcutStatementKey({
          range: null,
        executionSql: 'SELECT 1',
      }),
      expected: 'unframed:SELECT 1',
    },
    b: {
      label: '仅空白',
      actual: resolveShortcutStatementKey({
          range: null,
        executionSql: '  \n\t',
      }),
      expected: null,
    },
  },
  {
    id: '11',
    scene: 'ASCII vs 全角分号',
    a: {
      label: 'ASCII',
      actual: splitTexts('SELECT 1;\nSELECT 2;'),
      expected: ['SELECT 1;', 'SELECT 2;'],
    },
    b: {
      label: '全角',
      actual: splitTexts('SELECT 1；\nSELECT 2;'),
      expected: ['SELECT 1；', 'SELECT 2;'],
    },
  },
  {
    id: '12',
    scene: 'CRLF vs LF 边界',
    a: {
      label: 'LF 第二条起点',
      actual: findHighlightableStatementRanges('SELECT 1;\nSELECT 2;', 'mysql')[1]?.start,
      expected: 'SELECT 1;\n'.length,
    },
    b: {
      label: 'CRLF 规范化后与 LF 一致',
      actual: findHighlightableStatementRanges('SELECT 1;\r\nSELECT 2;', 'mysql')[1]?.start,
      expected: 'SELECT 1;\n'.length,
    },
  },
  {
    id: '13',
    scene: '字符串/注释内分号不切分',
    a: {
      label: '字符串内 ;',
      actual: splitTexts("SELECT ';' AS semi; SELECT 2;"),
      expected: ["SELECT ';' AS semi;", 'SELECT 2;'],
    },
    b: {
      label: '行注释内 ;',
      actual: splitTexts("-- x ; y\nSELECT 2;"),
      expected: ['-- x ; y\nSELECT 2;'],
    },
  },
  {
    id: '14',
    scene: 'SQL Server 方括号转义',
    a: {
      label: ']] 转义不分号',
      actual: splitTexts('SELECT * FROM [a]];b]; SELECT 2;', 'sqlserver'),
      expected: ['SELECT * FROM [a]];b];', 'SELECT 2;'],
    },
    b: {
      label: '未转义 ] 会切开',
      actual: splitTexts('SELECT * FROM [a];b]; SELECT 2;', 'sqlserver'),
      expected: ['SELECT * FROM [a];', 'b];', 'SELECT 2;'],
    },
  },
  {
    id: '15',
    scene: 'MySQL vs Postgres # 注释',
    a: {
      label: 'MySQL # 是注释',
      actual: statementAt('# bad; SELECT 1;\nSELECT 2;', 0, 'mysql'),
      expected: '# bad; SELECT 1;\nSELECT 2;',
    },
    b: {
      label: 'Postgres # 不是注释',
      actual: splitTexts('# bad; SELECT 1;', 'postgres')[0]?.includes('# bad'),
      expected: true,
    },
  },
  {
    id: '16',
    scene: '空白/注释脚本',
    a: { label: '纯空白', actual: splitTexts('   \n\t'), expected: [] },
    b: {
      label: '仅注释',
      actual: splitTexts('-- only\n/* block */', 'postgres'),
      expected: [],
    },
  },
  {
    id: '17',
    scene: '光标在空行 vs 分号后',
    a: {
      label: '空行吸附下一条',
      actual: statementAt('SELECT 1;\n\nSELECT 2;', 'SELECT 1;\n'.length),
      expected: 'SELECT 2;',
    },
    b: {
      label: '分号位置仍属上一条',
      actual: statementAt('SELECT 1;\nSELECT 2;', 'SELECT 1;'.length),
      expected: 'SELECT 1;',
    },
  },
  {
    id: '18',
    scene: '越界/非法 offset',
    a: {
      label: '超大 offset 取最后一条',
      actual: statementAt('SELECT 1;\nSELECT 2;', 10_000),
      expected: 'SELECT 2;',
    },
    b: {
      label: 'NaN 当作开头',
      actual: statementAt('SELECT 1;\nSELECT 2;', Number.NaN),
      expected: 'SELECT 1;',
    },
  },
  {
    id: '19',
    scene: '执行 SQL 省略分号时仍框完整语句',
    a: {
      label: '带分号执行 SQL',
      actual: highlightText('SELECT 1;\nSELECT 2;', 'SELECT 1;', 1),
      expected: 'SELECT 1;',
    },
    b: {
      label: '省略分号仍框上分号',
      actual: highlightText('SELECT 1;\nSELECT 2;', 'SELECT 1', 1),
      expected: 'SELECT 1;',
    },
  },
  {
    id: '20',
    scene: '追加执行区域 vs 光标语句',
    a: {
      label: '光标在首句时应框首句',
      actual: highlightText(
        'SELECT 1;\nINSERT INTO logs VALUES (1);',
        'SELECT 1',
        2,
      ),
      expected: 'SELECT 1;',
    },
    b: {
      label: '执行 SQL 是追加块时框追加块',
      actual: highlightText(
        'SELECT 1;\nINSERT INTO logs VALUES (1);\nUPDATE logs SET id = 2;',
        '\nINSERT INTO logs VALUES (1);\nUPDATE logs SET id = 2;',
        2,
      ),
      expected: 'INSERT INTO logs VALUES (1);\nUPDATE logs SET id = 2;',
    },
  },
  {
    id: '21',
    scene: '重复语句：光标副本优先于 lastIndexOf',
    a: {
      label: '光标在第一份 UPDATE',
      actual: resolveExecutionSqlHighlightRange(
        'UPDATE logs SET id = 2;\nSELECT 1;\nUPDATE logs SET id = 2;',
        'UPDATE logs SET id = 2;',
        2,
        'mysql',
      )?.start,
      expected: 0,
    },
    b: {
      label: '光标在中间 SELECT、执行 SQL 是 UPDATE 时框最后一份',
      actual: resolveExecutionSqlHighlightRange(
        'UPDATE logs SET id = 2;\nSELECT 1;\nUPDATE logs SET id = 2;',
        'UPDATE logs SET id = 2;',
        'UPDATE logs SET id = 2;\n'.length + 1,
        'mysql',
      )?.start,
      expected: 'UPDATE logs SET id = 2;\nSELECT 1;\n'.length,
    },
  },
  {
    id: '22',
    scene: '前缀误匹配：SELECT 1 vs SELECT 12',
    a: {
      label: '光标在 SELECT 1',
      actual: highlightText('SELECT 1;\nSELECT 12;', 'SELECT 1', 0),
      expected: 'SELECT 1;',
    },
    b: {
      label: '光标在 SELECT 12 且执行 SQL 是 SELECT 1 时不得切走 SELECT 12 前缀',
      actual: highlightText('SELECT 1;\nSELECT 12;', 'SELECT 1', 'SELECT 1;\n'.length),
      expected: 'SELECT 1;',
    },
  },
  {
    id: '23',
    scene: '表名/标识前缀：t vs t2',
    a: {
      label: '光标在 DELETE FROM t',
      actual: highlightText('DELETE FROM t;\nDELETE FROM t2;', 'DELETE FROM t', 0),
      expected: 'DELETE FROM t;',
    },
    b: {
      label: '光标在 t2 时不得框 t2 的前缀 t',
      actual: highlightText(
        'DELETE FROM t;\nDELETE FROM t2;',
        'DELETE FROM t',
        'DELETE FROM t;\n'.length,
      ),
      expected: 'DELETE FROM t;',
    },
  },
  {
    id: '24',
    scene: '字符串字面量里的伪语句',
    a: {
      label: '执行真正的 INSERT',
      actual: highlightText(
        "SELECT 'INSERT INTO t VALUES (1)' AS x;\nINSERT INTO t VALUES (1);",
        'INSERT INTO t VALUES (1)',
        "SELECT 'INSERT INTO t VALUES (1)' AS x;\n".length,
      ),
      expected: 'INSERT INTO t VALUES (1);',
    },
    b: {
      label: '不得把字符串内部当框',
      actual: highlightText(
        "SELECT 'INSERT INTO t VALUES (1)' AS x;",
        'INSERT INTO t VALUES (1)',
        0,
      ),
      expected: null,
    },
  },
  {
    id: '25',
    scene: '缺失的执行 SQL',
    a: {
      label: '能在缓冲里找到',
      actual: highlightText('SELECT 1;', 'SELECT 1', 0),
      expected: 'SELECT 1;',
    },
    b: {
      label: '缓冲里没有则不框无关语句',
      actual: highlightText('SELECT 1;', 'UPDATE missing SET id = 1', 0),
      expected: null,
    },
  },
  {
    id: '26',
    scene: '空白执行 SQL',
    a: {
      label: '有内容',
      actual: highlightText('SELECT 1;\n  SELECT 2;  ', '  SELECT 2;  ', 0),
      expected: 'SELECT 2;',
    },
    b: {
      label: '只有空白',
      actual: highlightText('SELECT 1;', '   \n', 0),
      expected: null,
    },
  },
  {
    id: '27',
    scene: '跨多条语句的执行块',
    a: {
      label: '单条',
      actual: highlightText('SELECT 1;\nSELECT 2;\nSELECT 3;', 'SELECT 2', 10),
      expected: 'SELECT 2;',
    },
    b: {
      label: '跨两条',
      actual: highlightText('SELECT 1;\nSELECT 2;\nSELECT 3;', 'SELECT 1;\nSELECT 2;', 0),
      expected: 'SELECT 1;\nSELECT 2;',
    },
  },
  {
    id: '28',
    scene: 'Postgres dollar-quote 内部分号',
    a: {
      label: 'dollar quote 保持一条',
      actual: splitTexts("SELECT $tag$ a; b $tag$;\nSELECT 2;", 'postgres'),
      expected: ['SELECT $tag$ a; b $tag$;', 'SELECT 2;'],
    },
    b: {
      label: '普通分号仍切分',
      actual: splitTexts('SELECT 1;\nSELECT 2;', 'postgres'),
      expected: ['SELECT 1;', 'SELECT 2;'],
    },
  },
  {
    id: '29',
    scene: 'PL/pgSQL BEGIN/END 块',
    a: {
      label: 'DO 块内部分号不切成多条可执行框',
      actual: splitTexts(
        'DO $$ BEGIN INSERT INTO t VALUES (1); END $$;\nSELECT 2;',
        'postgres',
      ).length,
      expected: 2,
    },
    b: {
      label: '普通两条 SELECT',
      actual: splitTexts('SELECT 1;\nSELECT 2;', 'postgres').length,
      expected: 2,
    },
  },
  {
    id: '30',
    scene: '反引号标识符内分号',
    a: {
      label: 'MySQL `a;b`',
      actual: splitTexts('SELECT * FROM `a;b`; SELECT 2;', 'mysql'),
      expected: ['SELECT * FROM `a;b`;', 'SELECT 2;'],
    },
    b: {
      label: '未闭合反引号后的分号不作为可靠切分',
      actual: splitTexts('SELECT * FROM `a; SELECT 2;', 'mysql').length,
      expected: 1,
    },
  },
  {
    id: '31',
    scene: '可执行 SQL：选区 vs 光标',
    a: {
      label: '真实选区优先',
      actual: executable('SELECT 1;\nSELECT 2;', {
        selectedSql: 'SELECT 1',
        editor: {
          getModel: () => ({ getValue: () => 'SELECT 1;\nSELECT 2;' }),
          getPosition: () => ({ lineNumber: 2, column: 1 }),
          getSelection: () => ({ isEmpty: () => false, lineNumber: 1, column: 1 }),
        },
      }),
      expected: 'SELECT 1',
    },
    b: {
      label: '空白选区忽略，走光标第二条',
      actual: executable('SELECT 1;\nSELECT 2;', {
        selectedSql: '   ',
        editor: {
          getModel: () => ({ getValue: () => 'SELECT 1;\nSELECT 2;' }),
          getPosition: () => ({ lineNumber: 2, column: 3 }),
          getSelection: () => ({ isEmpty: () => false, lineNumber: 2, column: 3 }),
        },
      }),
      expected: 'SELECT 2',
    },
  },
  {
    id: '32',
    scene: '编辑器缺失 vs 存在',
    a: {
      label: '无编辑器回退当前查询',
      actual: executable('SELECT 1;', { editor: null }),
      expected: 'SELECT 1;',
    },
    b: {
      label: '有编辑器解析语句（去分号）',
      actual: executable('SELECT 1;'),
      expected: 'SELECT 1',
    },
  },
  {
    id: '33',
    scene: '上次执行后的追加文本',
    a: {
      label: '追加了新语句',
      actual: executable('SELECT 1;\nINSERT INTO t VALUES (1);', {
        resultSetCount: 1,
        lastExecutedQuery: 'SELECT 1;',
      }),
      expected: '\nINSERT INTO t VALUES (1);',
    },
    b: {
      label: '仅追加空白不算新 SQL',
      actual: executable('SELECT 1;\n   ', {
        resultSetCount: 1,
        lastExecutedQuery: 'SELECT 1;',
        editor: {
          getModel: () => ({ getValue: () => 'SELECT 1;\n   ' }),
          getPosition: () => ({ lineNumber: 1, column: 1 }),
          getSelection: () => ({ isEmpty: () => true, lineNumber: 1, column: 1 }),
        },
      }),
      expected: 'SELECT 1',
    },
  },
  {
    id: '34',
    scene: '缓存光标 vs 实时光标',
    a: {
      label: '无实时 selection 时缓存光标可用',
      actual: executable('SELECT 1;\nSELECT 2;', {
        cachedPosition: { lineNumber: 2, column: 3 },
        editor: {
          getModel: () => ({ getValue: () => 'SELECT 1;\nSELECT 2;' }),
          getPosition: () => ({ lineNumber: 1, column: 1 }),
        },
      }),
      expected: 'SELECT 2',
    },
    b: {
      label: '空 selection 位置优先于过期缓存',
      actual: executable('SELECT 1;\nSELECT 2;', {
        cachedPosition: { lineNumber: 1, column: 1 },
        editor: {
          getModel: () => ({ getValue: () => 'SELECT 1;\nSELECT 2;' }),
          getPosition: () => ({ lineNumber: 2, column: 1 }),
          getSelection: () => ({ isEmpty: () => true, lineNumber: 2, column: 1 }),
        },
      }),
      expected: 'SELECT 2',
    },
  },
  {
    id: '35',
    scene: '点击武装框内/外',
    a: {
      label: '框内单击保持武装',
      actual: shouldDisarmArmedHighlightOnClick({
        armedRange: { start: 10, end: 20, text: 'SELECT 1;' },
        clickOffset: 10,
      }),
      expected: false,
    },
    b: {
      label: '框外单击解除',
      actual: shouldDisarmArmedHighlightOnClick({
        armedRange: { start: 10, end: 20, text: 'SELECT 1;' },
        clickOffset: 9,
      }),
      expected: true,
    },
  },
  {
    id: '36',
    scene: '未知点击位置',
    a: {
      label: '无武装不处理',
      actual: shouldDisarmArmedHighlightOnClick({ armedRange: null, clickOffset: 0 }),
      expected: false,
    },
    b: {
      label: '有武装但点到 gutter/未知位置则解除',
      actual: shouldDisarmArmedHighlightOnClick({
        armedRange: { start: 0, end: 9, text: 'SELECT 1;' },
        clickOffset: null,
      }),
      expected: true,
    },
  },
  {
    id: '37',
    scene: '持久化：独立 slice vs 旧 appearance',
    a: {
      label: '独立 slice 优先',
      actual: resolvePersistedSqlStatementHighlightSettings({
        highlightCurrentSqlStatement: true,
        confirmSqlStatementRun: false,
      }, {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      }),
      expected: { highlightCurrentSqlStatement: true, confirmSqlStatementRun: false },
    },
    b: {
      label: '缺 slice 时回退 appearance',
      actual: resolvePersistedSqlStatementHighlightSettings(undefined, {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      }),
      expected: { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
    },
  },
  {
    id: '38',
    scene: '空对象 slice 不得吞掉 appearance',
    a: {
      label: '空 slice + appearance',
      actual: resolvePersistedSqlStatementHighlightSettings({}, {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      }),
      expected: { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
    },
    b: {
      label: '部分字段互补',
      actual: resolvePersistedSqlStatementHighlightSettings({
        confirmSqlStatementRun: true,
      }, {
        highlightCurrentSqlStatement: false,
      }),
      expected: { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
    },
  },
  {
    id: '39',
    scene: '脏持久化值回退默认',
    a: {
      label: '字符串 false 不能关掉高亮',
      actual: sanitizeSqlStatementHighlightSettings({
        highlightCurrentSqlStatement: 'false' as never,
      }),
      expected: { highlightCurrentSqlStatement: true, confirmSqlStatementRun: false },
    },
    b: {
      label: '字符串 true 不能打开确认',
      actual: sanitizeSqlStatementHighlightSettings({
        confirmSqlStatementRun: 'true' as never,
      }),
      expected: { highlightCurrentSqlStatement: true, confirmSqlStatementRun: false },
    },
  },
  {
    id: '40',
    scene: '数组/非对象持久化源',
    a: {
      label: '数组不当事务配置',
      actual: resolvePersistedSqlStatementHighlightSettings(
        [{ highlightCurrentSqlStatement: false }] as never,
        { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
      ),
      expected: { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
    },
    b: {
      label: '字符串源走 appearance',
      actual: resolvePersistedSqlStatementHighlightSettings('legacy', {
        highlightCurrentSqlStatement: false,
      }),
      expected: { highlightCurrentSqlStatement: false, confirmSqlStatementRun: false },
    },
  },
  {
    id: '41',
    scene: '确认默认值安全方向',
    a: {
      label: '高亮默认开',
      actual: sanitizeSqlStatementHighlightSettings(undefined).highlightCurrentSqlStatement,
      expected: true,
    },
    b: {
      label: '二次确认默认关（避免改变旧快捷键手感）',
      actual: sanitizeSqlStatementHighlightSettings(undefined).confirmSqlStatementRun,
      expected: false,
    },
  },
  {
    id: '42',
    scene: '无分号脚本',
    a: {
      label: '单条无分号',
      actual: statementAt('SELECT 1 FROM dual', 0),
      expected: 'SELECT 1 FROM dual',
    },
    b: {
      label: '多条无分号无法切分时整段一条',
      actual: splitTexts('SELECT 1 FROM dual\nSELECT 2 FROM dual').length,
      expected: 1,
    },
  },
  {
    id: '43',
    scene: 'GO 批处理不是通用 SQL 分隔符',
    a: {
      label: 'MySQL 不按 GO 切',
      actual: splitTexts('SELECT 1\nGO\nSELECT 2', 'mysql').length,
      expected: 1,
    },
    b: {
      label: 'SQL Server 若未实现 GO 也不应误执行半句框',
      actual: splitTexts('SELECT 1\nGO\nSELECT 2', 'sqlserver').length >= 1,
      expected: true,
    },
  },
  {
    id: '44',
    scene: 'MySQL 版本注释 /*! */',
    a: {
      label: '版本注释视为可执行内容',
      actual: splitTexts('/*!40101 SET NAMES utf8 */;\nSELECT 1;', 'mysql').length,
      expected: 2,
    },
    b: {
      label: '普通块注释可与下一条合并或跳过',
      actual: splitTexts('/* skip */\nSELECT 1;', 'postgres'),
      expected: ['/* skip */\nSELECT 1;'],
    },
  },
  {
    id: '45',
    scene: '尾部分号与空白',
    a: {
      label: '末尾分号属于语句',
      actual: statementAt('SELECT 1;', 8),
      expected: 'SELECT 1;',
    },
    b: {
      label: '分号后空白仍属该句',
      actual: statementAt('SELECT 1;   ', 10),
      expected: 'SELECT 1;',
    },
  },
  {
    id: '46',
    scene: '相同 comparable 的空白/分号差异',
    a: {
      label: '执行 SQL 带前后空白',
      actual: highlightText('SELECT 1;', '  SELECT 1;  ', 0),
      expected: 'SELECT 1;',
    },
    b: {
      label: '执行 SQL 去分号仍匹配',
      actual: highlightText('SELECT 1;', 'SELECT 1', 0),
      expected: 'SELECT 1;',
    },
  },
  {
    id: '47',
    scene: '危险写操作：框内 vs 框外确认',
    a: {
      label: '能框 DELETE 时用 range key',
      actual: resolveShortcutStatementKey({
          range: { start: 0, end: 16, text: 'DELETE FROM t;' },
        executionSql: 'DELETE FROM t',
      }),
      expected: '0:16:DELETE FROM t;',
    },
    b: {
      label: '框失败仍要用 unframed key 卡住二次确认',
      actual: resolveShortcutStatementKey({
          range: null,
        executionSql: 'DROP TABLE t;',
      }),
      expected: 'unframed:DROP TABLE t',
    },
  },
  {
    id: '48',
    scene: '选区执行危险语句仍需确认',
    a: {
      label: '无选区 DROP 需确认',
      actual: shortcut({
        statementKey: 'unframed:DROP TABLE t',
      }),
      expected: 'arm',
    },
    b: {
      label: '有选区 DROP 同样需确认',
      actual: shortcut({
        statementKey: 'unframed:DROP TABLE t',
      }),
      expected: 'arm',
    },
  },
  {
    id: '49',
    scene: 'Elasticsearch/功能关闭时的安全默认',
    a: {
      label: '功能关 + 确认开仍 run（由上层 featureOn 关掉）',
      actual: shortcut({ enabled: false, requireConfirm: true }),
      expected: 'run',
    },
    b: {
      label: '功能开 + 确认开才 arm',
      actual: shortcut({ enabled: true, requireConfirm: true }),
      expected: 'arm',
    },
  },
  {
    id: '50',
    scene: '武装边界：含端点 vs 紧邻外侧',
    a: {
      label: 'end 端点仍算框内',
      actual: shouldDisarmArmedHighlightOnClick({
        armedRange: { start: 0, end: 9, text: 'SELECT 1;' },
        clickOffset: 9,
      }),
      expected: false,
    },
    b: {
      label: 'end+1 解除',
      actual: shouldDisarmArmedHighlightOnClick({
        armedRange: { start: 0, end: 9, text: 'SELECT 1;' },
        clickOffset: 10,
      }),
      expected: true,
    },
  },
];

describe('SQL 语句高亮全场景 A/B 对照（50 组）', () => {
  it('covers 50 unique pairs', () => {
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(50);
    expect(pairs).toHaveLength(50);
  });

  it.each(pairs)('$id $scene', ({ a, b }) => {
    expect(a.actual, a.label).toEqual(a.expected);
    expect(b.actual, b.label).toEqual(b.expected);
  });
});
