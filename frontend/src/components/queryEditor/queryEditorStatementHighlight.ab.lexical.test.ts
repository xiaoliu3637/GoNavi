import { describe, expect, it } from 'vitest';

import {
  findHighlightableStatementRanges,
  resolveHighlightableStatementRange,
} from './queryEditorStatementHighlight';

type ABPair = {
  id: string;
  scene: string;
  a: { label: string; run: () => unknown; expected: unknown };
  b: { label: string; run: () => unknown; expected: unknown };
};

const texts = (sql: string, dbType = '') => (
  findHighlightableStatementRanges(sql, dbType).map((range) => range.text)
);

const hashLine = 'SELECT 1 # c;\nSELECT 2;';

const pairs: ABPair[] = [
  {
    id: 'L01',
    scene: 'mysql 把 # 当行注释 vs postgres 不把 # 当注释',
    a: {
      label: 'mysql：# 行上的分号不切，两行合成一条',
      run: () => texts(hashLine, 'mysql'),
      expected: ['SELECT 1 # c;\nSELECT 2;'],
    },
    b: {
      label: 'postgres：# 后的分号切开',
      run: () => texts(hashLine, 'postgres'),
      expected: ['SELECT 1 # c;', 'SELECT 2;'],
    },
  },
  {
    id: 'L02',
    scene: 'mysql 的 --x 不当注释 vs postgres 的 --x 当注释',
    a: {
      label: 'mysql：减号后无空白，分号仍切开',
      run: () => texts('SELECT 1 --x;\nSELECT 2;', 'mysql'),
      expected: ['SELECT 1 --x;', 'SELECT 2;'],
    },
    b: {
      label: 'postgres：--x 注释掉分号，两行合成一条',
      run: () => texts('SELECT 1 --x;\nSELECT 2;', 'postgres'),
      expected: ['SELECT 1 --x;\nSELECT 2;'],
    },
  },
  {
    id: 'L03',
    scene: 'sqlserver 转义方括号不在内部切分 vs mysql 按分号切开',
    a: {
      label: 'sqlserver：]] 转义，内部 ; 不切',
      run: () => texts('SELECT [a]];b];', 'sqlserver'),
      expected: ['SELECT [a]];b];'],
    },
    b: {
      label: 'mysql：方括号无标识符语义，按 ; 切开',
      run: () => texts('SELECT [a]];b];', 'mysql'),
      expected: ['SELECT [a]];', 'b];'],
    },
  },
  {
    id: 'L04',
    scene: 'mssql 归一成 sqlserver vs postgres 不支持方括号转义',
    a: {
      label: 'mssql：归一后 ]] 转义生效',
      run: () => texts('SELECT [a]];b];', 'mssql'),
      expected: ['SELECT [a]];b];'],
    },
    b: {
      label: 'postgres：方括号不转义，按 ; 切开',
      run: () => texts('SELECT [a]];b];', 'postgres'),
      expected: ['SELECT [a]];', 'b];'],
    },
  },
  {
    id: 'L05',
    scene: 'doris 与 mysql 一样把 # 当注释 vs oracle 不把 # 当注释',
    a: {
      label: 'doris：归一为 diros 后 # 仍是行注释',
      run: () => texts(hashLine, 'doris'),
      expected: ['SELECT 1 # c;\nSELECT 2;'],
    },
    b: {
      label: 'oracle：# 后的分号切开',
      run: () => texts(hashLine, 'oracle'),
      expected: ['SELECT 1 # c;', 'SELECT 2;'],
    },
  },
  {
    id: 'L06',
    scene: 'greatdb 归一后 # 是注释 vs sqlite 的 # 不是注释',
    a: {
      label: 'greatdb：归一为 goldendb 后 # 是行注释',
      run: () => texts(hashLine, 'greatdb'),
      expected: ['SELECT 1 # c;\nSELECT 2;'],
    },
    b: {
      label: 'sqlite：# 后的分号切开',
      run: () => texts(hashLine, 'sqlite'),
      expected: ['SELECT 1 # c;', 'SELECT 2;'],
    },
  },
  {
    id: 'L07',
    scene: 'postgres 标签 dollar $tag$ 内不切 vs 普通分号脚本会切（$$ 在 mysql 同样不切）',
    a: {
      label: 'postgres：$tag$ 内的分号不切',
      run: () => texts('SELECT $tag$ a; b $tag$;', 'postgres'),
      expected: ['SELECT $tag$ a; b $tag$;'],
    },
    b: {
      label: 'postgres：普通分号脚本切开',
      run: () => texts('SELECT a; SELECT b;', 'postgres'),
      expected: ['SELECT a;', 'SELECT b;'],
    },
  },
  {
    id: 'L08',
    scene: 'mysql 反引号标识符不切 vs 没有反引号会切',
    a: {
      label: '反引号 `a;b` 内的分号不切',
      run: () => texts('SELECT `a;b`;', 'mysql'),
      expected: ['SELECT `a;b`;'],
    },
    b: {
      label: '无反引号的 a;b 按分号切开',
      run: () => texts('SELECT a;b;', 'mysql'),
      expected: ['SELECT a;', 'b;'],
    },
  },
  {
    id: 'L09',
    scene: 'postgres 双引号不切 vs postgres 无引号会切（mysql 对同一双引号文本同样不切）',
    a: {
      label: 'postgres 双引号 "a;b" 不切',
      run: () => texts('SELECT "a;b";', 'postgres'),
      expected: ['SELECT "a;b";'],
    },
    b: {
      label: 'postgres 无引号按分号切开',
      run: () => texts('SELECT a;b;', 'postgres'),
      expected: ['SELECT a;', 'b;'],
    },
  },
  {
    id: 'L10',
    scene: '单引号里的分号不切 vs 引号外分号会切',
    a: {
      label: "单引号 'a;b' 不切",
      run: () => texts("SELECT 'a;b';", 'mysql'),
      expected: ["SELECT 'a;b';"],
    },
    b: {
      label: '引号外分号切开',
      run: () => texts('SELECT a; b;', 'mysql'),
      expected: ['SELECT a;', 'b;'],
    },
  },
  {
    id: 'L11',
    scene: "单引号 '' 包住分号不切 vs 未成对引号吞掉后续分号",
    a: {
      label: "'' 包住分号，后面的 SELECT 2 仍独立",
      run: () => texts("SELECT 'a'';b'; SELECT 2;", 'mysql'),
      expected: ["SELECT 'a'';b';", 'SELECT 2;'],
    },
    b: {
      label: '未成对引号把后续分号一起吞成一条',
      run: () => texts("SELECT 'a;b; SELECT 2;", 'mysql'),
      expected: ["SELECT 'a;b; SELECT 2;"],
    },
  },
  {
    id: 'L12',
    scene: 'mysql 版本注释算可执行语句 vs postgres 同一注释不算',
    a: {
      label: 'mysql：/*!40101 */ 与 SELECT 1 是两条',
      run: () => texts('/*!40101 SET NAMES utf8 */;\nSELECT 1;', 'mysql'),
      expected: ['/*!40101 SET NAMES utf8 */;', 'SELECT 1;'],
    },
    b: {
      label: 'postgres：版本注释被丢掉，只剩 SELECT 1',
      run: () => texts('/*!40101 SET NAMES utf8 */;\nSELECT 1;', 'postgres'),
      expected: ['SELECT 1;'],
    },
  },
  {
    id: 'L13',
    scene: 'mariadb /*M! */ 可执行 vs mysql 丢掉同一注释',
    a: {
      label: 'mariadb：/*M! */ 与 SELECT 1 是两条',
      run: () => texts('/*M! SET x=1 */; SELECT 1;', 'mariadb'),
      expected: ['/*M! SET x=1 */;', 'SELECT 1;'],
    },
    b: {
      label: 'mysql：/*M! */ 不是可执行语句',
      run: () => texts('/*M! SET x=1 */; SELECT 1;', 'mysql'),
      expected: ['SELECT 1;'],
    },
  },
  {
    id: 'L14',
    scene: '双分号语句条数 vs 单分号语句条数（空语句被丢掉）',
    a: {
      label: 'SELECT 1;;SELECT 2; 丢掉空语句',
      run: () => texts('SELECT 1;;SELECT 2;', 'mysql').length,
      expected: 2,
    },
    b: {
      label: 'SELECT 1;SELECT 2; 也是两条',
      run: () => texts('SELECT 1;SELECT 2;', 'mysql').length,
      expected: 2,
    },
  },
  {
    id: 'L15',
    scene: '仅注释脚本 ranges 为空 vs 注释并进后面的真实语句',
    a: {
      label: '只有行注释',
      run: () => texts('-- only comment', 'mysql'),
      expected: [],
    },
    b: {
      label: '注释后的 SELECT 把注释并进同一条',
      run: () => texts('-- only comment\nSELECT 1;', 'mysql'),
      expected: ['-- only comment\nSELECT 1;'],
    },
  },
  {
    id: 'L16',
    scene: '全角分号包含进语句文本 vs 分号后的下一条独立',
    a: {
      label: '全角分号留在语句文本里',
      run: () => texts('SELECT 1；', 'mysql'),
      expected: ['SELECT 1；'],
    },
    b: {
      label: '全角分号后的 SELECT 2 是独立语句',
      run: () => texts('SELECT 1；SELECT 2;', 'mysql'),
      expected: ['SELECT 1；', 'SELECT 2;'],
    },
  },
  {
    id: 'L17',
    scene: '光标在中文语句分号上仍是整句 vs 光标在下一句上是第二句',
    a: {
      label: '光标在第一句分号上',
      run: () => {
        const sql = "SELECT '中文'; SELECT 2;";
        return resolveHighlightableStatementRange(sql, sql.indexOf(';'), 'mysql')?.text;
      },
      expected: "SELECT '中文';",
    },
    b: {
      label: '光标在 SELECT 2 上',
      run: () => {
        const sql = "SELECT '中文'; SELECT 2;";
        return resolveHighlightableStatementRange(sql, sql.indexOf('SELECT 2'), 'mysql')?.text;
      },
      expected: 'SELECT 2;',
    },
  },
  {
    id: 'L18',
    scene: '块注释内分号不切 vs 注释结束后的分号切开下一条',
    a: {
      label: '注释里的分号不切',
      run: () => texts('/* ; */ SELECT 1;', 'mysql'),
      expected: ['/* ; */ SELECT 1;'],
    },
    b: {
      label: '注释结束后的分号切开 SELECT 2',
      run: () => texts('/* c */ SELECT 1; SELECT 2;', 'mysql'),
      expected: ['/* c */ SELECT 1;', 'SELECT 2;'],
    },
  },
];

describe('SQL 语句高亮 A/B：词法与方言（18 组）', () => {
  it('covers 18 unique pairs', () => {
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(18);
    expect(pairs).toHaveLength(18);
  });
  it.each(pairs)('$id $scene', ({ a, b }) => {
    expect(a.run(), a.label).toEqual(a.expected);
    expect(b.run(), b.label).toEqual(b.expected);
  });
});
