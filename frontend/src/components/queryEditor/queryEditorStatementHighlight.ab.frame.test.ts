/** @vitest-environment jsdom */

import React, { useRef } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';

vi.mock('antd', () => ({
  message: {
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../i18n', () => ({
  t: (key: string) => key,
}));

import type { SqlStatementRange } from '../../utils/sqlStatementSelection';
import { getNormalizedOffsetAtPosition } from './QueryEditorHelpers';
import {
  alignMiddleOverlayRectsToLongest,
  buildStatementHighlightKey,
  buildStatementOverlayRects,
  buildWrappedStatementPolygon,
  findHighlightableStatementRanges,
  padOverlayRect,
  padStackedOverlayRects,
  type OverlayRect,
  type RunShortcutAction,
  type StatementLineSlice,
} from './queryEditorStatementHighlight';
import {
  bindStatementHighlightEditor,
  editorHasNonEmptySelection,
  paintStatementFrame,
  readStatementHighlightSql,
  type OverlayRefs,
  type StatementHighlightEditor,
} from './queryEditorStatementHighlightOverlay';
import { useQueryEditorStatementHighlight } from './useQueryEditorStatementHighlight';

type ABPair = {
  id: string;
  scene: string;
  a: { label: string; run: () => unknown; expected: unknown };
  b: { label: string; run: () => unknown; expected: unknown };
};

type EditorPosition = { lineNumber: number; column: number };

type Listeners = {
  mouseMove?: (event: { target?: { position?: EditorPosition | null } }) => void;
  mouseDown?: (event: { target?: { position?: EditorPosition | null } }) => void;
  scroll?: () => void;
  layout?: () => void;
  content?: () => void;
  cursor?: () => void;
  keyDown?: (event: { keyCode?: number; preventDefault?: () => void }) => void;
};

const FRAME_SQL = 'SELECT 1;\nSELECT 2;';
const UNFRAMED_KEY = 'unframed:DELETE FROM t';
const HOOK_SQL = 'SELECT 1;';
const MISSING_SQL = 'DELETE FROM missing';

const listedStatements = findHighlightableStatementRanges(FRAME_SQL, 'mysql');
const FIRST_STATEMENT = listedStatements[0];
const SECOND_STATEMENT = listedStatements[1];
if (!FIRST_STATEMENT || !SECOND_STATEMENT) {
  throw new Error('SELECT 1; / SELECT 2; did not split into two statements');
}

const FIRST_KEY = buildStatementHighlightKey(FIRST_STATEMENT);

const columnFor = (
  lineNumber: number,
  accept: (offset: number) => boolean,
) => {
  for (let column = 1; column <= FRAME_SQL.length + 2; column += 1) {
    const offset = getNormalizedOffsetAtPosition(FRAME_SQL, { lineNumber, column });
    if (accept(offset)) return { lineNumber, column, offset };
  }
  throw new Error(`line ${lineNumber} has no matching column`);
};

const CLICK_INSIDE = columnFor(1, (offset) => (
  offset >= FIRST_STATEMENT.start && offset <= FIRST_STATEMENT.end
));
const CLICK_OUTSIDE = columnFor(2, (offset) => offset > FIRST_STATEMENT.end);
const CURSOR_MOVE = columnFor(1, (offset) => (
  offset > FIRST_STATEMENT.start && offset <= FIRST_STATEMENT.end
));

const snapRect = (rect: OverlayRect) => ({
  left: rect.left,
  top: rect.top,
  width: rect.width,
  height: rect.height,
  right: rect.left + rect.width,
});

const frameOf = (node: SVGSVGElement | null) => ({
  className: node?.className?.baseVal || node?.getAttribute('class') || '',
  display: node?.style.display || '',
});

const withSyncFrames = <T>(body: () => T): T => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  try {
    return body();
  } finally {
    vi.unstubAllGlobals();
  }
};

const visiblePosition = (lineNumber: number, column: number) => ({
  left: column <= 1 ? 8 : 80,
  top: (lineNumber - 1) * 18 + 10,
  height: 18,
});

const createPaintHost = (sql = FRAME_SQL) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor: StatementHighlightEditor = {
    getDomNode: () => host,
    getModel: () => ({ getValue: () => sql }),
    getScrolledVisiblePosition: ({ column, lineNumber }) => visiblePosition(lineNumber, column),
  };
  return {
    editor,
    dispose: () => host.remove(),
  };
};

const createBinding = ({
  armedKey = null,
  armedRange = null,
  resolveRange = (position: EditorPosition | null) => (
    position?.lineNumber === 2 ? SECOND_STATEMENT : FIRST_STATEMENT
  ),
}: {
  armedKey?: string | null;
  armedRange?: SqlStatementRange | null;
  resolveRange?: (position: EditorPosition | null) => SqlStatementRange | null;
} = {}) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const listeners: Listeners = {};
  let position: EditorPosition = { lineNumber: 1, column: 1 };
  const refs: OverlayRefs = {
    overlay: null,
    armedKey,
    armedRange,
    hoverRange: null,
  };
  let paints = 0;
  const onDisarm = vi.fn();
  const editor: StatementHighlightEditor = {
    getDomNode: () => host,
    getModel: () => ({ getValue: () => FRAME_SQL, getVersionId: () => 1 }),
    getPosition: () => position,
    getSelection: () => ({ isEmpty: () => true }),
    getScrolledVisiblePosition: ({ column, lineNumber }) => visiblePosition(lineNumber, column),
    onMouseMove: (listener) => {
      listeners.mouseMove = listener;
      return { dispose: vi.fn() };
    },
    onMouseDown: (listener) => {
      listeners.mouseDown = listener;
      return { dispose: vi.fn() };
    },
    onDidScrollChange: (listener) => {
      listeners.scroll = listener;
      return { dispose: vi.fn() };
    },
    onDidLayoutChange: (listener) => {
      listeners.layout = listener;
      return { dispose: vi.fn() };
    },
    onDidChangeModelContent: (listener) => {
      listeners.content = listener;
      return { dispose: vi.fn() };
    },
    onDidChangeCursorPosition: (listener) => {
      listeners.cursor = listener;
      return { dispose: vi.fn() };
    },
    onKeyDown: (listener) => {
      listeners.keyDown = listener;
      return { dispose: vi.fn() };
    },
  };
  const disposables = bindStatementHighlightEditor({
    editor,
    getCanInteract: () => true,
    getCanPaint: () => true,
    resolveRange,
    refs,
    onOverlay: (overlay) => {
      refs.overlay = overlay;
      paints += 1;
    },
    onDisarm,
    onModelInvalidated: () => undefined,
  });
  return {
    host,
    listeners,
    refs,
    onDisarm,
    setPosition: (next: EditorPosition) => {
      position = next;
    },
    paintCount: () => paints,
    frame: () => host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame'),
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      host.remove();
    },
  };
};

const useBinding = <T>(
  options: Parameters<typeof createBinding>[0],
  body: (binding: ReturnType<typeof createBinding>) => T,
) => {
  const binding = createBinding(options);
  try {
    return body(binding);
  } finally {
    binding.dispose();
  }
};

const statementAt = (position: EditorPosition | null): SqlStatementRange | null => {
  if (!position) return null;
  const offset = getNormalizedOffsetAtPosition(FRAME_SQL, position);
  if (offset >= FIRST_STATEMENT.start && offset <= FIRST_STATEMENT.end) return FIRST_STATEMENT;
  if (offset >= SECOND_STATEMENT.start && offset <= SECOND_STATEMENT.end) return SECOND_STATEMENT;
  return null;
};

const rightSeamXs = (rects: OverlayRect[], points: Array<{ x: number; y: number }>) => {
  const seamY = rects[0].top + rects[0].height;
  const rights = new Set(rects.map((rect) => rect.left + rect.width));
  return points.filter((point) => point.y === seamY && rights.has(point.x)).map((point) => point.x);
};

type ShortcutProbeProps = {
  editor: StatementHighlightEditor;
  executionSql: string;
  enabled?: boolean;
  requireConfirm?: boolean;
  isElasticsearchMode?: boolean;
  onReady: (arm: () => RunShortcutAction) => void;
};

const ShortcutProbe = ({
  editor,
  executionSql,
  enabled = true,
  requireConfirm = true,
  isElasticsearchMode = false,
  onReady,
}: ShortcutProbeProps) => {
  const editorRef = useRef<StatementHighlightEditor | null>(editor);
  const { tryArmOrRunFromShortcut } = useQueryEditorStatementHighlight({
    editorRef,
    enabled,
    requireConfirm,
    isActive: true,
    isRunning: false,
    isElasticsearchMode,
    dbType: 'mysql',
    getExecutionSql: () => executionSql,
  });
  onReady(tryArmOrRunFromShortcut);
  return null;
};

const openShortcut = (props: Omit<ShortcutProbeProps, 'editor' | 'onReady'> & { sql?: string }) => {
  vi.mocked(message.info).mockClear();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor: StatementHighlightEditor = {
    getDomNode: () => host,
    getModel: () => ({
      getValue: () => props.sql ?? HOOK_SQL,
      getValueInRange: () => '',
      getVersionId: () => 1,
    }),
    getPosition: () => ({ lineNumber: 1, column: 1 }),
    getSelection: () => ({ isEmpty: () => true }),
    getScrolledVisiblePosition: ({ column, lineNumber }) => visiblePosition(lineNumber, column),
    onMouseMove: () => ({ dispose: () => undefined }),
    onMouseDown: () => ({ dispose: () => undefined }),
    onDidScrollChange: () => ({ dispose: () => undefined }),
    onDidLayoutChange: () => ({ dispose: () => undefined }),
    onDidChangeModel: () => ({ dispose: () => undefined }),
    onDidChangeModelContent: () => ({ dispose: () => undefined }),
    onDidChangeCursorPosition: () => ({ dispose: () => undefined }),
    onKeyDown: () => ({ dispose: () => undefined }),
  };
  let arm: (() => RunShortcutAction) | undefined;
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(ShortcutProbe, {
      editor,
      executionSql: props.executionSql,
      enabled: props.enabled,
      requireConfirm: props.requireConfirm,
      isElasticsearchMode: props.isElasticsearchMode,
      onReady: (next) => {
        arm = next;
      },
    }));
  });
  return {
    host,
    arm: () => {
      if (!arm) throw new Error('shortcut hook is not ready');
      return arm();
    },
    unmount: () => {
      act(() => renderer?.unmount());
      host.remove();
    },
  };
};

const withShortcut = <T>(
  props: Omit<ShortcutProbeProps, 'editor' | 'onReady'> & { sql?: string },
  body: (session: ReturnType<typeof openShortcut>) => T,
) => {
  const session = openShortcut(props);
  try {
    return body(session);
  } finally {
    session.unmount();
  }
};

const verticalPads = (raw: OverlayRect, padded: OverlayRect) => ({
  top: raw.top - padded.top,
  bottom: (padded.top + padded.height) - (raw.top + raw.height),
});

const singleRect: OverlayRect = { left: 10, top: 20, width: 100, height: 18 };
const stackedRects: OverlayRect[] = [
  { left: 10, top: 20, width: 100, height: 18 },
  { left: 16, top: 38, width: 70, height: 18 },
];
const twoLineRects: OverlayRect[] = [
  { left: 8, top: 0, width: 40, height: 18 },
  { left: 20, top: 18, width: 30, height: 18 },
];
const threeLineRects: OverlayRect[] = [
  { left: 12, top: 0, width: 40, height: 16 },
  { left: 28, top: 16, width: 10, height: 16 },
  { left: 18, top: 32, width: 22, height: 16 },
];
const sameWidthRows: OverlayRect[] = [
  { left: 10, top: 0, width: 80, height: 18 },
  { left: 10, top: 18, width: 80, height: 18 },
];
const differentWidthRows: OverlayRect[] = [
  { left: 10, top: 0, width: 80, height: 18 },
  { left: 10, top: 18, width: 40, height: 18 },
];
const overlaySlices: StatementLineSlice[] = [
  { lineNumber: 1, startColumn: 1, endColumn: 9 },
  { lineNumber: 2, startColumn: 1, endColumn: 8 },
];

const pairs: ABPair[] = [
  {
    id: 'F01',
    scene: '单行四周 padding 与两行堆叠垂直贴合',
    a: {
      label: '单行上下左右都加 padding',
      run: () => {
        const padded = padOverlayRect(singleRect);
        return {
          rect: snapRect(padded),
          pads: {
            left: singleRect.left - padded.left,
            right: (padded.left + padded.width) - (singleRect.left + singleRect.width),
            ...verticalPads(singleRect, padded),
          },
        };
      },
      expected: {
        rect: { left: 7, top: 17, width: 106, height: 24, right: 113 },
        pads: { left: 3, right: 3, top: 3, bottom: 3 },
      },
    },
    b: {
      label: '两行只有首行加 top、末行加 bottom，接缝贴合',
      run: () => {
        const padded = padStackedOverlayRects(stackedRects);
        return {
          rects: padded.map(snapRect),
          first: verticalPads(stackedRects[0], padded[0]),
          last: verticalPads(stackedRects[1], padded[1]),
          seamTouch: padded[0].top + padded[0].height === padded[1].top,
        };
      },
      expected: {
        rects: [
          { left: 7, top: 17, width: 106, height: 21, right: 113 },
          { left: 13, top: 38, width: 76, height: 21, right: 89 },
        ],
        first: { top: 3, bottom: 0 },
        last: { top: 0, bottom: 3 },
        seamTouch: true,
      },
    },
  },
  {
    id: 'F02',
    scene: '中间行向最长行对齐',
    a: {
      label: '只有两行时原样返回',
      run: () => {
        const aligned = alignMiddleOverlayRectsToLongest(twoLineRects);
        return { sameReference: aligned === twoLineRects, rects: aligned.map(snapRect) };
      },
      expected: {
        sameReference: true,
        rects: [
          { left: 8, top: 0, width: 40, height: 18, right: 48 },
          { left: 20, top: 18, width: 30, height: 18, right: 50 },
        ],
      },
    },
    b: {
      label: '三行时中间行拉到其余行 left，宽度伸到全局 max right，末行保留自己的 right',
      run: () => {
        const aligned = alignMiddleOverlayRectsToLongest(threeLineRects);
        return { sameReference: aligned === threeLineRects, rects: aligned.map(snapRect) };
      },
      expected: {
        sameReference: false,
        rects: [
          { left: 12, top: 0, width: 40, height: 16, right: 52 },
          { left: 18, top: 16, width: 34, height: 16, right: 52 },
          { left: 18, top: 32, width: 22, height: 16, right: 40 },
        ],
      },
    },
  },
  {
    id: 'F03',
    scene: '不可见行被丢弃',
    a: {
      label: '某一行 getVisiblePosition 返回 null 时该行丢弃',
      run: () => ({
        sliceCount: overlaySlices.length,
        rectCount: buildStatementOverlayRects(overlaySlices, (lineNumber, column) => (
          lineNumber === 2 && column === overlaySlices[1].endColumn
            ? null
            : { left: column === 1 ? 8 : 40, top: lineNumber * 20, height: 16 }
        )).length,
      }),
      expected: { sliceCount: 2, rectCount: 1 },
    },
    b: {
      label: '每行都有坐标时行数等于 slice 数',
      run: () => ({
        sliceCount: overlaySlices.length,
        rectCount: buildStatementOverlayRects(
          overlaySlices,
          (lineNumber, column) => ({
            left: column === 1 ? 8 : 40,
            top: lineNumber * 20,
            height: 16,
          }),
        ).length,
      }),
      expected: { sliceCount: 2, rectCount: 2 },
    },
  },
  {
    id: 'F04',
    scene: '多边形空数组与单矩形',
    a: {
      label: '空数组',
      run: () => buildWrappedStatementPolygon([]),
      expected: [],
    },
    b: {
      label: '单个矩形四个角，顺序为左上、右上、右下、左下',
      run: () => buildWrappedStatementPolygon([{ left: 5, top: 7, width: 11, height: 13 }]),
      expected: [
        { x: 5, y: 7 },
        { x: 16, y: 7 },
        { x: 16, y: 20 },
        { x: 5, y: 20 },
      ],
    },
  },
  {
    id: 'F05',
    scene: '相邻行等宽与不等宽的接缝',
    a: {
      label: '宽度相同，接缝不额外插入重复 x 点',
      run: () => {
        const points = buildWrappedStatementPolygon(sameWidthRows);
        return { points, rightSeamXs: rightSeamXs(sameWidthRows, points) };
      },
      expected: {
        points: [
          { x: 10, y: 0 },
          { x: 90, y: 0 },
          { x: 90, y: 18 },
          { x: 90, y: 36 },
          { x: 10, y: 36 },
          { x: 10, y: 18 },
        ],
        rightSeamXs: [90],
      },
    },
    b: {
      label: '宽度不同，接缝处 x 从上一行 right 变到下一行 right',
      run: () => {
        const points = buildWrappedStatementPolygon(differentWidthRows);
        return { points, rightSeamXs: rightSeamXs(differentWidthRows, points) };
      },
      expected: {
        points: [
          { x: 10, y: 0 },
          { x: 90, y: 0 },
          { x: 90, y: 18 },
          { x: 50, y: 18 },
          { x: 50, y: 36 },
          { x: 10, y: 36 },
          { x: 10, y: 18 },
        ],
        rightSeamXs: [90, 50],
      },
    },
  },
  {
    id: 'F06',
    scene: 'hover 与 armed 的 svg class',
    a: {
      label: 'armedRange 为空、hoverRange 有值时 class 不含 is-armed',
      run: () => {
        const host = createPaintHost();
        try {
          const refs: OverlayRefs = {
            overlay: null,
            armedKey: null,
            armedRange: null,
            hoverRange: FIRST_STATEMENT,
          };
          return frameOf(paintStatementFrame(host.editor, refs, true));
        } finally {
          host.dispose();
        }
      },
      expected: {
        className: 'gonavi-query-editor-statement-frame',
        display: 'block',
      },
    },
    b: {
      label: 'armedRange 有值时 class 含 is-armed',
      run: () => {
        const host = createPaintHost();
        try {
          const refs: OverlayRefs = {
            overlay: null,
            armedKey: FIRST_KEY,
            armedRange: FIRST_STATEMENT,
            hoverRange: null,
          };
          return frameOf(paintStatementFrame(host.editor, refs, true));
        } finally {
          host.dispose();
        }
      },
      expected: {
        className: 'gonavi-query-editor-statement-frame is-armed',
        display: 'block',
      },
    },
  },
  {
    id: 'F07',
    scene: '无 range 隐藏与有 range 显示',
    a: {
      label: '没有任何 range 时 display 为 none',
      run: () => {
        const host = createPaintHost();
        try {
          const refs: OverlayRefs = {
            overlay: null,
            armedKey: null,
            armedRange: null,
            hoverRange: null,
          };
          return frameOf(paintStatementFrame(host.editor, refs, true)).display;
        } finally {
          host.dispose();
        }
      },
      expected: 'none',
    },
    b: {
      label: '有 range 且坐标可用时 display 为 block',
      run: () => {
        const host = createPaintHost();
        try {
          const refs: OverlayRefs = {
            overlay: null,
            armedKey: null,
            armedRange: null,
            hoverRange: FIRST_STATEMENT,
          };
          return frameOf(paintStatementFrame(host.editor, refs, true)).display;
        } finally {
          host.dispose();
        }
      },
      expected: 'block',
    },
  },
  {
    id: 'F08',
    scene: '选区是否包含可见文本',
    a: {
      label: '选区文本只有空白',
      run: () => editorHasNonEmptySelection({
        getSelection: () => ({ isEmpty: () => false }),
        getModel: () => ({ getValueInRange: () => '   \n\t' }),
      }),
      expected: false,
    },
    b: {
      label: '选区文本为 SELECT 1',
      run: () => editorHasNonEmptySelection({
        getSelection: () => ({ isEmpty: () => false }),
        getModel: () => ({ getValueInRange: () => 'SELECT 1' }),
      }),
      expected: true,
    },
  },
  {
    id: 'F09',
    scene: '读取编辑器 SQL',
    a: {
      label: 'CRLF 规范成 LF',
      run: () => readStatementHighlightSql({
        getModel: () => ({ getValue: () => 'SELECT 1;\r\nSELECT 2;' }),
      }),
      expected: 'SELECT 1;\nSELECT 2;',
    },
    b: {
      label: '模型缺失时返回空字符串',
      run: () => readStatementHighlightSql({ getModel: () => null }),
      expected: '',
    },
  },
  {
    id: 'F10',
    scene: 'mouseleave 对 hover 与武装框',
    a: {
      label: '未武装时 mouseleave 清掉 hover 并隐藏',
      run: () => withSyncFrames(() => useBinding({}, (binding) => {
        binding.listeners.mouseMove?.({ target: { position: { lineNumber: 1, column: 1 } } });
        const before = {
          hoverText: binding.refs.hoverRange?.text ?? null,
          ...frameOf(binding.frame()),
        };
        binding.host.dispatchEvent(new Event('mouseleave'));
        return {
          before,
          after: {
            hoverText: binding.refs.hoverRange?.text ?? null,
            display: frameOf(binding.frame()).display,
          },
        };
      })),
      expected: {
        before: {
          hoverText: 'SELECT 1;',
          className: 'gonavi-query-editor-statement-frame',
          display: 'block',
        },
        after: { hoverText: null, display: 'none' },
      },
    },
    b: {
      label: '已武装时 mouseleave 仍保持 is-armed 可见',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        binding.host.dispatchEvent(new Event('mouseleave'));
        const frame = frameOf(binding.frame());
        return {
          className: frame.className,
          display: frame.display,
          armedKey: binding.refs.armedKey,
        };
      }),
      expected: {
        className: 'gonavi-query-editor-statement-frame is-armed',
        display: 'block',
        armedKey: '0:9:SELECT 1;',
      },
    },
  },
  {
    id: 'F11',
    scene: '内容变化解除武装，滚动只重绘',
    a: {
      label: '内容变化会 onDisarm',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        const baseline = binding.paintCount();
        binding.listeners.content?.();
        return {
          disarms: binding.onDisarm.mock.calls.length,
          repaints: binding.paintCount() - baseline,
        };
      }),
      expected: { disarms: 1, repaints: 1 },
    },
    b: {
      label: '滚动只重绘，不 onDisarm',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        const baseline = binding.paintCount();
        binding.listeners.scroll?.();
        return {
          disarms: binding.onDisarm.mock.calls.length,
          repaints: binding.paintCount() - baseline,
        };
      }),
      expected: { disarms: 0, repaints: 1 },
    },
  },
  {
    id: 'F12',
    scene: 'Escape 与其他按键',
    a: {
      label: 'Monaco keyCode 9 会 disarm 且 preventDefault',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        const preventDefault = vi.fn();
        binding.listeners.keyDown?.({ keyCode: 9, preventDefault });
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          prevented: preventDefault.mock.calls.length > 0,
        };
      }),
      expected: { disarmed: true, prevented: true },
    },
    b: {
      label: '其他 keyCode 不 disarm',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        const preventDefault = vi.fn();
        binding.listeners.keyDown?.({ keyCode: 10, preventDefault });
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          prevented: preventDefault.mock.calls.length > 0,
        };
      }),
      expected: { disarmed: false, prevented: false },
    },
  },
  {
    id: 'F13',
    scene: '点击框内与框外',
    a: {
      label: '点击第一句框内不 disarm',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        binding.listeners.mouseDown?.({ target: { position: CLICK_INSIDE } });
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          lineNumber: CLICK_INSIDE.lineNumber,
          column: CLICK_INSIDE.column,
          offset: CLICK_INSIDE.offset,
        };
      }),
      expected: { disarmed: false, lineNumber: 1, column: 1, offset: 0 },
    },
    b: {
      label: '点击第二句框外会 disarm',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        binding.listeners.mouseDown?.({ target: { position: CLICK_OUTSIDE } });
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          lineNumber: CLICK_OUTSIDE.lineNumber,
          column: CLICK_OUTSIDE.column,
          offset: CLICK_OUTSIDE.offset,
        };
      }),
      expected: { disarmed: true, lineNumber: 2, column: 1, offset: 10 },
    },
  },
  {
    id: 'F14',
    scene: 'mousemove 在未武装与已武装时',
    a: {
      label: '未武装时 mousemove 设置 hoverRange',
      run: () => withSyncFrames(() => useBinding({}, (binding) => {
        binding.listeners.mouseMove?.({ target: { position: { lineNumber: 1, column: 1 } } });
        return {
          hoverText: binding.refs.hoverRange?.text ?? null,
          armedKey: binding.refs.armedKey,
          disarmed: binding.onDisarm.mock.calls.length > 0,
        };
      })),
      expected: { hoverText: 'SELECT 1;', armedKey: null, disarmed: false },
    },
    b: {
      label: '已有 armedKey 时 mousemove 不改 hover、不解除武装',
      run: () => withSyncFrames(() => useBinding({
        armedKey: FIRST_KEY,
        armedRange: FIRST_STATEMENT,
      }, (binding) => {
        binding.refs.hoverRange = SECOND_STATEMENT;
        binding.listeners.mouseMove?.({ target: { position: { lineNumber: 1, column: 1 } } });
        return {
          hoverText: binding.refs.hoverRange?.text ?? null,
          armedKey: binding.refs.armedKey,
          disarmed: binding.onDisarm.mock.calls.length > 0,
        };
      })),
      expected: { hoverText: 'SELECT 2;', armedKey: '0:9:SELECT 1;', disarmed: false },
    },
  },
  {
    id: 'F15',
    scene: '无框确认的点击，对照框内点击',
    a: {
      label: 'unframed 且 armedRange 为 null 时，点在语句内也会 onDisarm',
      run: () => useBinding({ armedKey: UNFRAMED_KEY, armedRange: null }, (binding) => {
        binding.listeners.mouseDown?.({ target: { position: CLICK_INSIDE } });
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          armedKey: UNFRAMED_KEY,
          armedRange: null,
          offset: CLICK_INSIDE.offset,
        };
      }),
      expected: { disarmed: true, armedKey: UNFRAMED_KEY, armedRange: null, offset: 0 },
    },
    b: {
      label: 'armedRange 框住当前语句且点击框内时不 disarm',
      run: () => useBinding({ armedKey: FIRST_KEY, armedRange: FIRST_STATEMENT }, (binding) => {
        binding.listeners.mouseDown?.({ target: { position: CLICK_INSIDE } });
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          armedKey: binding.refs.armedKey,
          offset: CLICK_INSIDE.offset,
        };
      }),
      expected: { disarmed: false, armedKey: '0:9:SELECT 1;', offset: 0 },
    },
  },
  {
    id: 'F16',
    scene: '无框确认的光标移动，对照句内移动',
    a: {
      label: 'unframed 且 armedRange 为 null 时，光标移动会 onDisarm',
      run: () => useBinding({
        armedKey: UNFRAMED_KEY,
        armedRange: null,
        resolveRange: statementAt,
      }, (binding) => {
        binding.setPosition(CURSOR_MOVE);
        binding.listeners.cursor?.();
        const cursorRange = statementAt(CURSOR_MOVE);
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          armedKey: UNFRAMED_KEY,
          cursorKey: cursorRange ? buildStatementHighlightKey(cursorRange) : null,
          fromOffset: CLICK_INSIDE.offset,
          toOffset: CURSOR_MOVE.offset,
        };
      }),
      expected: {
        disarmed: true,
        armedKey: UNFRAMED_KEY,
        cursorKey: '0:9:SELECT 1;',
        fromOffset: 0,
        toOffset: 1,
      },
    },
    b: {
      label: 'armedKey 就是光标所在语句时，句内移动不 disarm',
      run: () => useBinding({
        armedKey: FIRST_KEY,
        armedRange: FIRST_STATEMENT,
        resolveRange: statementAt,
      }, (binding) => {
        binding.setPosition(CURSOR_MOVE);
        binding.listeners.cursor?.();
        const cursorRange = statementAt(CURSOR_MOVE);
        return {
          disarmed: binding.onDisarm.mock.calls.length > 0,
          armedKey: binding.refs.armedKey,
          cursorKey: cursorRange ? buildStatementHighlightKey(cursorRange) : null,
          fromOffset: CLICK_INSIDE.offset,
          toOffset: CURSOR_MOVE.offset,
        };
      }),
      expected: {
        disarmed: false,
        armedKey: '0:9:SELECT 1;',
        cursorKey: '0:9:SELECT 1;',
        fromOffset: 0,
        toOffset: 1,
      },
    },
  },
  {
    id: 'F17',
    scene: '执行 SQL 找不到框时的确认开关',
    a: {
      label: 'requireConfirm 为 true：第一次 arm 并 message.info，第二次 run',
      run: () => withShortcut({
        executionSql: MISSING_SQL,
        sql: HOOK_SQL,
        requireConfirm: true,
      }, (session) => {
        const first = session.arm();
        const second = session.arm();
        return {
          first,
          second,
          infoCalls: vi.mocked(message.info).mock.calls.length,
        };
      }),
      expected: { first: 'arm', second: 'run', infoCalls: 1 },
    },
    b: {
      label: 'requireConfirm 为 false：第一次就 run，且不调用 message.info',
      run: () => withShortcut({
        executionSql: MISSING_SQL,
        sql: HOOK_SQL,
        requireConfirm: false,
      }, (session) => ({
        first: session.arm(),
        infoCalls: vi.mocked(message.info).mock.calls.length,
      })),
      expected: { first: 'run', infoCalls: 0 },
    },
  },
  {
    id: 'F18',
    scene: '高亮关闭与 Elasticsearch 都不确认',
    a: {
      label: 'enabled 为 false：第一次就 run，不提示，overlay 不是 is-armed',
      run: () => withShortcut({
        executionSql: MISSING_SQL,
        sql: HOOK_SQL,
        enabled: false,
        requireConfirm: true,
      }, (session) => ({
        action: session.arm(),
        infoCalls: vi.mocked(message.info).mock.calls.length,
        armedVisible: Boolean(
          session.host.querySelector('.gonavi-query-editor-statement-frame.is-armed'),
        ),
      })),
      expected: { action: 'run', infoCalls: 0, armedVisible: false },
    },
    b: {
      label: 'isElasticsearchMode 为 true：第一次就 run，不提示，overlay 不是 is-armed',
      run: () => withShortcut({
        executionSql: MISSING_SQL,
        sql: HOOK_SQL,
        enabled: true,
        requireConfirm: true,
        isElasticsearchMode: true,
      }, (session) => ({
        action: session.arm(),
        infoCalls: vi.mocked(message.info).mock.calls.length,
        armedVisible: Boolean(
          session.host.querySelector('.gonavi-query-editor-statement-frame.is-armed'),
        ),
      })),
      expected: { action: 'run', infoCalls: 0, armedVisible: false },
    },
  },
];

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.mocked(message.info).mockClear();
});

describe('SQL 语句高亮 A/B：框几何与快捷键生命周期（18 组）', () => {
  it('pairs 长度为 18 且 id 唯一', () => {
    expect(pairs).toHaveLength(18);
    expect(new Set(pairs.map((pair) => pair.id)).size).toBe(18);
    expect(pairs.map((pair) => pair.id)).toEqual([
      'F01', 'F02', 'F03', 'F04', 'F05', 'F06',
      'F07', 'F08', 'F09', 'F10', 'F11', 'F12',
      'F13', 'F14', 'F15', 'F16', 'F17', 'F18',
    ]);
  });

  it.each(pairs)('$id $scene', ({ a, b }) => {
    expect(a.run(), a.label).toEqual(a.expected);
    expect(b.run(), b.label).toEqual(b.expected);
  });
});
