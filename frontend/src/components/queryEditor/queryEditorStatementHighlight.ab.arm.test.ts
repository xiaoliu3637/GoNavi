import { describe, expect, it } from 'vitest';

import {
  createSqlStatementHighlightSlice,
  resolvePersistedSqlStatementHighlightSettings,
  type SqlStatementHighlightSettings,
  type SqlStatementHighlightSlice,
} from '../../store/sqlStatementHighlightSlice';
import type { SqlStatementRange } from '../../utils/sqlStatementSelection';
import {
  buildUnframedExecutionHighlightKey,
  resolveRunShortcutAction,
  resolveShortcutStatementKey,
  shouldDisarmArmedHighlightOnClick,
} from './queryEditorStatementHighlight';

type ABPair = {
  id: string;
  scene: string;
  a: { label: string; run: () => unknown; expected: unknown };
  b: { label: string; run: () => unknown; expected: unknown };
};

type ShortcutInput = {
  enabled: boolean;
  requireConfirm: boolean;
  statementKey: string | null;
  armedKey: string | null;
};

const shortcut = (input: ShortcutInput) => resolveRunShortcutAction(input);

const confirmOn = (
  statementKey: string | null,
  armedKey: string | null,
  enabled = true,
): ShortcutInput => ({
  enabled,
  requireConfirm: true,
  statementKey,
  armedKey,
});

const span = (start: number, end: number): SqlStatementRange => ({
  start,
  end,
  text: 'SELECT 1',
});

const disarm = (
  armedRange: SqlStatementRange | null,
  clickOffset: number | null,
) => shouldDisarmArmedHighlightOnClick({ armedRange, clickOffset });

const persisted = (settings: unknown, legacyAppearance?: unknown) => (
  resolvePersistedSqlStatementHighlightSettings(settings, legacyAppearance)
);

const bothEnabled: SqlStatementHighlightSettings = {
  highlightCurrentSqlStatement: true,
  confirmSqlStatementRun: true,
};

const updateHighlightSlice = (
  current: SqlStatementHighlightSettings,
  patch: Partial<SqlStatementHighlightSettings>,
): SqlStatementHighlightSettings => {
  let next = current;
  const set = (
    updater: (state: SqlStatementHighlightSlice) => Partial<SqlStatementHighlightSlice>,
  ) => {
    const updated = updater({
      sqlStatementHighlight: next,
      setSqlStatementHighlightSettings: () => undefined,
    });
    if (updated.sqlStatementHighlight) {
      next = updated.sqlStatementHighlight;
    }
  };
  createSqlStatementHighlightSlice(set).setSqlStatementHighlightSettings(patch);
  return next;
};

const selectKey = '0:8:SELECT 1';
const dropKey = 'unframed:DROP TABLE t';
const dropKey2 = 'unframed:DROP TABLE t2';

const pairs: ABPair[] = [
  {
    id: 'A01',
    scene: 'requireConfirm 为 true 且未武装时 arm；同一 statementKey 已武装时 run',
    a: {
      label: '未武装 → arm',
      run: () => shortcut(confirmOn(selectKey, null)),
      expected: 'arm',
    },
    b: {
      label: '同一 key 已武装 → run',
      run: () => shortcut(confirmOn(selectKey, selectKey)),
      expected: 'run',
    },
  },
  {
    id: 'A02',
    scene: 'requireConfirm 为 false 时未武装也 run；enabled 为 false 时即使要求确认也 run',
    a: {
      label: '确认关、未武装 → run',
      run: () => shortcut({
        enabled: true,
        requireConfirm: false,
        statementKey: selectKey,
        armedKey: null,
      }),
      expected: 'run',
    },
    b: {
      label: '高亮关、确认开、未武装 → run',
      run: () => shortcut(confirmOn(selectKey, null, false)),
      expected: 'run',
    },
  },
  {
    id: 'A03',
    scene: 'statementKey 为 null 时 run；unframed DROP 的 key 非空时 arm',
    a: {
      label: 'statementKey null → run',
      run: () => shortcut(confirmOn(null, null)),
      expected: 'run',
    },
    b: {
      label: 'unframed DROP → arm',
      run: () => {
        const statementKey = buildUnframedExecutionHighlightKey('DROP TABLE t');
        return {
          statementKey,
          action: shortcut(confirmOn(statementKey, null)),
        };
      },
      expected: { statementKey: dropKey, action: 'arm' },
    },
  },
  {
    id: 'A04',
    scene: '已武装 DROP TABLE t 时 DROP TABLE t2 仍 arm；同一 unframed key 第二次 run',
    a: {
      label: 'armedKey 是 t、当前是 t2 → arm',
      run: () => {
        const armedKey = buildUnframedExecutionHighlightKey('DROP TABLE t');
        const statementKey = buildUnframedExecutionHighlightKey('DROP TABLE t2');
        return {
          armedKey,
          statementKey,
          distinct: armedKey !== statementKey,
          action: shortcut(confirmOn(statementKey, armedKey)),
        };
      },
      expected: {
        armedKey: dropKey,
        statementKey: dropKey2,
        distinct: true,
        action: 'arm',
      },
    },
    b: {
      label: '同一 unframed key 第二次 → run',
      run: () => {
        const key = buildUnframedExecutionHighlightKey('DROP TABLE t');
        return {
          statementKey: key,
          armedKey: key,
          action: shortcut(confirmOn(key, key)),
        };
      },
      expected: {
        statementKey: dropKey,
        armedKey: dropKey,
        action: 'run',
      },
    },
  },
  {
    id: 'A05',
    scene: 'DROP TABLE t; 与首尾空白的同一语句 unframed key 相同；全角分号 DROP TABLE t； 的真实 key 也相同',
    a: {
      label: '分号与首尾空白',
      run: () => ({
        semicolon: buildUnframedExecutionHighlightKey('DROP TABLE t;'),
        padded: buildUnframedExecutionHighlightKey('  DROP TABLE t  '),
      }),
      expected: {
        semicolon: dropKey,
        padded: dropKey,
      },
    },
    b: {
      label: '全角分号',
      run: () => {
        const fullwidth = buildUnframedExecutionHighlightKey('DROP TABLE t；');
        const ascii = buildUnframedExecutionHighlightKey('DROP TABLE t;');
        return { fullwidth, ascii, same: fullwidth === ascii };
      },
      expected: { fullwidth: dropKey, ascii: dropKey, same: true },
    },
  },
  {
    id: 'A06',
    scene: '空白执行 SQL 的 key 为 null；只有分号 ;;; 的真实 key 是 unframed:;; 而不是 null，因此 B 改为对照 SELECT 1',
    a: {
      label: '空白为 null，;;; 记录真实 key',
      run: () => ({
        blank: buildUnframedExecutionHighlightKey('   '),
        semicolons: buildUnframedExecutionHighlightKey(';;;'),
      }),
      expected: { blank: null, semicolons: 'unframed:;;' },
    },
    b: {
      label: 'SELECT 1 的 unframed key',
      run: () => buildUnframedExecutionHighlightKey('SELECT 1'),
      expected: 'unframed:SELECT 1',
    },
  },
  {
    id: 'A07',
    scene: '有 range 时 shortcut key 用 range，忽略 executionSql 文本差异；range 为 null 时才用 executionSql',
    a: {
      label: '有 range 时忽略 executionSql',
      run: () => {
        const range = span(0, 8);
        const selectText = resolveShortcutStatementKey({ range, executionSql: 'SELECT 1' });
        const dropText = resolveShortcutStatementKey({ range, executionSql: 'DROP TABLE t' });
        return { selectText, dropText, ignoredText: selectText === dropText };
      },
      expected: {
        selectText: selectKey,
        dropText: selectKey,
        ignoredText: true,
      },
    },
    b: {
      label: 'range null 时用 executionSql',
      run: () => resolveShortcutStatementKey({
        range: null,
        executionSql: 'DROP TABLE t',
      }),
      expected: dropKey,
    },
  },
  {
    id: 'A08',
    scene: '点击偏移等于 start 不解除；start-1 解除',
    a: {
      label: 'clickOffset === start 不解除',
      run: () => disarm(span(4, 12), 4),
      expected: false,
    },
    b: {
      label: 'clickOffset === start-1 解除',
      run: () => disarm(span(4, 12), 3),
      expected: true,
    },
  },
  {
    id: 'A09',
    scene: '点击偏移等于 end 不解除；end+1 解除',
    a: {
      label: 'clickOffset === end 不解除',
      run: () => disarm(span(4, 12), 12),
      expected: false,
    },
    b: {
      label: 'clickOffset === end+1 解除',
      run: () => disarm(span(4, 12), 13),
      expected: true,
    },
  },
  {
    id: 'A10',
    scene: 'clickOffset 为 null 解除；落在区间内不解除',
    a: {
      label: 'clickOffset null 解除',
      run: () => disarm(span(4, 12), null),
      expected: true,
    },
    b: {
      label: 'clickOffset 在 [4,12] 内不解除',
      run: () => disarm(span(4, 12), 8),
      expected: false,
    },
  },
  {
    id: 'A11',
    scene: 'clickOffset 为 NaN 解除；clickOffset 0 落在 [0,9] 内不解除',
    a: {
      label: 'clickOffset NaN 解除',
      run: () => disarm(span(0, 9), Number.NaN),
      expected: true,
    },
    b: {
      label: 'clickOffset 0 在 [0,9] 内不解除',
      run: () => disarm(span(0, 9), 0),
      expected: false,
    },
  },
  {
    id: 'A12',
    scene: 'shouldDisarmArmedHighlightOnClick：armedRange 为 null 返回 false；区间存在且点击在外面返回 true',
    a: {
      label: 'armedRange null → false',
      run: () => ({
        fn: 'shouldDisarmArmedHighlightOnClick',
        armedRange: null,
        clickOffset: 0,
        result: disarm(null, 0),
      }),
      expected: {
        fn: 'shouldDisarmArmedHighlightOnClick',
        armedRange: null,
        clickOffset: 0,
        result: false,
      },
    },
    b: {
      label: '点在区间外 → true',
      run: () => {
        const armedRange = span(4, 9);
        return {
          fn: 'shouldDisarmArmedHighlightOnClick',
          armedRange,
          clickOffset: 0,
          result: disarm(armedRange, 0),
        };
      },
      expected: {
        fn: 'shouldDisarmArmedHighlightOnClick',
        armedRange: span(4, 9),
        clickOffset: 0,
        result: true,
      },
    },
  },
  {
    id: 'A13',
    scene: 'slice 只有 confirm true、legacy highlight false：高亮取 legacy false、确认取 slice true；slice 显式 highlight true 覆盖 legacy false',
    a: {
      label: '缺 highlight 时回退 legacy',
      run: () => persisted(
        { confirmSqlStatementRun: true },
        { highlightCurrentSqlStatement: false },
      ),
      expected: {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      },
    },
    b: {
      label: 'slice 显式 highlight true 覆盖 legacy false',
      run: () => persisted(
        { highlightCurrentSqlStatement: true, confirmSqlStatementRun: true },
        { highlightCurrentSqlStatement: false },
      ),
      expected: {
        highlightCurrentSqlStatement: true,
        confirmSqlStatementRun: true,
      },
    },
  },
  {
    id: 'A14',
    scene: 'slice 为数组时不当配置并回退 legacy；slice 为普通对象时用 slice',
    a: {
      label: '数组 slice 回退 legacy',
      run: () => persisted(
        [{ highlightCurrentSqlStatement: true, confirmSqlStatementRun: true }],
        { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
      ),
      expected: {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      },
    },
    b: {
      label: '普通对象 slice 覆盖 legacy',
      run: () => persisted(
        { highlightCurrentSqlStatement: true, confirmSqlStatementRun: false },
        { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
      ),
      expected: {
        highlightCurrentSqlStatement: true,
        confirmSqlStatementRun: false,
      },
    },
  },
  {
    id: 'A15',
    scene: "字符串 'false' 与数字 0 不能当成 boolean：sanitize 后高亮用默认 true、确认用默认 false；对照真正的 false/true",
    a: {
      label: "非 boolean：'false' 与 0",
      run: () => persisted({
        highlightCurrentSqlStatement: 'false',
        confirmSqlStatementRun: 0,
      }),
      expected: {
        highlightCurrentSqlStatement: true,
        confirmSqlStatementRun: false,
      },
    },
    b: {
      label: '真正的 false / true',
      run: () => persisted({
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      }),
      expected: {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      },
    },
  },
  {
    id: 'A16',
    scene: 'slice 字段值为 null 时 ?? 落到 legacy；字段值为 false 时不落到 legacy',
    a: {
      label: 'null 落到 legacy',
      run: () => persisted(
        { highlightCurrentSqlStatement: null, confirmSqlStatementRun: null },
        { highlightCurrentSqlStatement: false, confirmSqlStatementRun: true },
      ),
      expected: {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      },
    },
    b: {
      label: 'false 保留，不落到 legacy true',
      run: () => persisted(
        { highlightCurrentSqlStatement: false, confirmSqlStatementRun: false },
        { highlightCurrentSqlStatement: true, confirmSqlStatementRun: true },
      ),
      expected: {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: false,
      },
    },
  },
  {
    id: 'A17',
    scene: 'createSqlStatementHighlightSlice：只更新 confirm 时保留原来的 highlight true；只更新 highlight 为 false 时保留原来的 confirm true',
    a: {
      label: '只更新 confirm，highlight 仍为 true',
      run: () => updateHighlightSlice(bothEnabled, { confirmSqlStatementRun: false }),
      expected: {
        highlightCurrentSqlStatement: true,
        confirmSqlStatementRun: false,
      },
    },
    b: {
      label: '只更新 highlight 为 false，confirm 仍为 true',
      run: () => updateHighlightSlice(bothEnabled, { highlightCurrentSqlStatement: false }),
      expected: {
        highlightCurrentSqlStatement: false,
        confirmSqlStatementRun: true,
      },
    },
  },
  {
    id: 'A18',
    scene: 'SELECT 与 DROP 的 key 不同：武装 SELECT 后再遇 DROP 必须 arm；武装 key 就是该 DROP 时 run',
    a: {
      label: '武装了 SELECT，当前 DROP → arm',
      run: () => {
        const armedKey = buildUnframedExecutionHighlightKey('SELECT 1');
        const statementKey = buildUnframedExecutionHighlightKey('DROP TABLE t');
        return {
          armedKey,
          statementKey,
          distinct: armedKey !== statementKey,
          action: shortcut(confirmOn(statementKey, armedKey)),
        };
      },
      expected: {
        armedKey: 'unframed:SELECT 1',
        statementKey: dropKey,
        distinct: true,
        action: 'arm',
      },
    },
    b: {
      label: '武装 key 就是该 DROP → run',
      run: () => {
        const key = buildUnframedExecutionHighlightKey('DROP TABLE t');
        return {
          statementKey: key,
          armedKey: key,
          action: shortcut(confirmOn(key, key)),
        };
      },
      expected: {
        statementKey: dropKey,
        armedKey: dropKey,
        action: 'run',
      },
    },
  },
];

describe('SQL 语句高亮 A/B：确认、点击与持久化（18 组）', () => {
  it('covers 18 unique pairs', () => {
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(18);
    expect(pairs).toHaveLength(18);
  });

  it.each(pairs)('$id $scene', ({ a, b }) => {
    expect(a.run(), a.label).toEqual(a.expected);
    expect(b.run(), b.label).toEqual(b.expected);
  });
});
