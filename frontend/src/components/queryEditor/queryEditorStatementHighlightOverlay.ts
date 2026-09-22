import type { SqlStatementRange } from '../../utils/sqlStatementSelection';
import {
  buildStatementOverlayRects,
  buildWrappedStatementPolygon,
  getStatementLineSlices,
  shouldDisarmArmedHighlightOnClick,
  type OverlayRect,
  type StatementHighlightMode,
} from './queryEditorStatementHighlight';
import { getNormalizedOffsetAtPosition } from './QueryEditorHelpers';

const OVERLAY_CLASS = 'gonavi-query-editor-statement-frame';
const MONACO_ESCAPE_KEY_CODE = 9;
const SVG_NS = 'http://www.w3.org/2000/svg';

export type StatementHighlightModel = {
  getValue?: () => string;
  getValueInRange?: (range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }) => string;
  getVersionId?: () => number;
};

export type StatementHighlightEditor = {
  getDomNode?: () => HTMLElement | null;
  getModel?: () => StatementHighlightModel | null;
  getPosition?: () => { lineNumber: number; column: number } | null;
  getSelection?: () => {
    isEmpty?: () => boolean;
    startLineNumber?: number;
    startColumn?: number;
    endLineNumber?: number;
    endColumn?: number;
  } | null;
  getScrolledVisiblePosition?: (position: { lineNumber: number; column: number }) => {
    left: number;
    top: number;
    height: number;
  } | null;
  onMouseMove?: (listener: (event: EditorPositionEvent) => void) => Disposable;
  onMouseDown?: (listener: (event: EditorPositionEvent) => void) => Disposable;
  onDidScrollChange?: (listener: () => void) => Disposable;
  onDidLayoutChange?: (listener: () => void) => Disposable;
  onDidChangeModel?: (listener: () => void) => Disposable;
  onDidChangeModelContent?: (listener: () => void) => Disposable;
  onDidChangeCursorPosition?: (listener: () => void) => Disposable;
  onKeyDown?: (listener: (event: { keyCode?: number; preventDefault?: () => void }) => void) => Disposable;
};

type Disposable = { dispose: () => void };
type EditorPosition = { lineNumber: number; column: number };
type EditorPositionEvent = { target?: { position?: EditorPosition | null } };

export type OverlayRefs = {
  overlay: SVGSVGElement | null;
  armedKey: string | null;
  armedRange: SqlStatementRange | null;
  hoverRange: SqlStatementRange | null;
};

const createSvgNode = <K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] | null => (
  typeof document !== 'undefined' && typeof document.createElementNS === 'function'
    ? document.createElementNS(SVG_NS, tag)
    : null
);

const applyOverlayPolygon = (
  svg: SVGSVGElement,
  rects: OverlayRect[],
  mode: StatementHighlightMode,
) => {
  svg.setAttribute('class', `${OVERLAY_CLASS}${mode === 'armed' ? ' is-armed' : ''}`);
  svg.style.display = 'block';
  let polygon = svg.querySelector('polygon');
  if (!polygon) {
    polygon = createSvgNode('polygon');
    if (!polygon) return;
    svg.appendChild(polygon);
  }
  polygon.setAttribute(
    'points',
    buildWrappedStatementPolygon(rects).map((point) => `${point.x},${point.y}`).join(' '),
  );
};

export const hideStatementOverlay = (node: SVGSVGElement | null) => {
  if (node) node.style.display = 'none';
};

export const readStatementHighlightSql = (editor: StatementHighlightEditor | null): string => (
  String(editor?.getModel?.()?.getValue?.() ?? '').replace(/\r\n/g, '\n')
);

export const editorHasNonEmptySelection = (editor: StatementHighlightEditor | null): boolean => {
  const selection = editor?.getSelection?.();
  if (!selection || selection.isEmpty?.()) return false;
  const model = editor?.getModel?.();
  if (!model?.getValueInRange) return false;
  return Boolean(model.getValueInRange({
    startLineNumber: Number(selection.startLineNumber || 1),
    startColumn: Number(selection.startColumn || 1),
    endLineNumber: Number(selection.endLineNumber || 1),
    endColumn: Number(selection.endColumn || 1),
  }).trim());
};

const ensureOverlayNode = (
  editor: StatementHighlightEditor,
  current: SVGSVGElement | null,
): SVGSVGElement | null => {
  const host = editor.getDomNode?.();
  if (!host) return current;
  if (current && current.parentElement === host) return current;
  current?.remove();
  const node = createSvgNode('svg');
  if (!node) return null;
  node.setAttribute('class', OVERLAY_CLASS);
  node.style.display = 'none';
  host.appendChild(node);
  return node;
};

export const paintStatementFrame = (
  editor: StatementHighlightEditor | null,
  refs: OverlayRefs,
  canPaint: boolean,
): SVGSVGElement | null => {
  if (!editor || !canPaint) {
    hideStatementOverlay(refs.overlay);
    return refs.overlay;
  }
  const overlay = ensureOverlayNode(editor, refs.overlay);
  if (!overlay) return refs.overlay;
  const range = refs.armedRange || refs.hoverRange;
  if (!range) {
    hideStatementOverlay(overlay);
    return overlay;
  }
  const rects = buildStatementOverlayRects(
    getStatementLineSlices(readStatementHighlightSql(editor), range),
    (lineNumber, column) => editor.getScrolledVisiblePosition?.({ lineNumber, column }) || null,
  );
  if (rects.length === 0) {
    hideStatementOverlay(overlay);
    return overlay;
  }
  applyOverlayPolygon(overlay, rects, refs.armedRange ? 'armed' : 'hover');
  return overlay;
};

const createMouseMoveScheduler = (run: (position: EditorPosition | null) => void) => {
  let frame: number | null = null;
  let pendingPosition: EditorPosition | null = null;
  const flush = () => {
    frame = null;
    run(pendingPosition);
  };
  return {
    schedule(position: EditorPosition | null) {
      pendingPosition = position;
      if (frame !== null) return;
      if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
        flush();
        return;
      }
      frame = window.requestAnimationFrame(flush);
    },
    dispose() {
      if (
        frame !== null
        && typeof window !== 'undefined'
        && typeof window.cancelAnimationFrame === 'function'
      ) {
        window.cancelAnimationFrame(frame);
      }
      frame = null;
    },
  };
};

export const bindStatementHighlightEditor = ({
  editor,
  getCanInteract,
  getCanPaint,
  resolveRange,
  refs,
  onOverlay,
  onDisarm,
  onModelInvalidated,
}: {
  editor: StatementHighlightEditor;
  getCanInteract: () => boolean;
  getCanPaint: () => boolean;
  resolveRange: (position: EditorPosition | null) => SqlStatementRange | null;
  refs: OverlayRefs;
  onOverlay: (overlay: SVGSVGElement | null) => void;
  onDisarm: () => void;
  onModelInvalidated: () => void;
}): Disposable[] => {
  const paint = () => onOverlay(paintStatementFrame(editor, refs, getCanPaint()));
  const mouseMove = createMouseMoveScheduler((position) => {
    if (!getCanInteract() || refs.armedKey) return;
    refs.hoverRange = resolveRange(position);
    paint();
  });
  const handleContentChange = () => {
    onModelInvalidated();
    onDisarm();
    refs.hoverRange = null;
    paint();
  };
  const handleCursorChange = () => {
    if (!refs.armedKey) {
      refs.hoverRange = null;
      paint();
      return;
    }
    if (!refs.armedRange) {
      onDisarm();
      paint();
      return;
    }
    const position = editor.getPosition?.() || null;
    const offset = position
      ? getNormalizedOffsetAtPosition(readStatementHighlightSql(editor), position)
      : null;
    if (shouldDisarmArmedHighlightOnClick({ armedRange: refs.armedRange, clickOffset: offset })) {
      onDisarm();
    }
    paint();
  };
  const handleMouseDown = (event: EditorPositionEvent) => {
    if (!refs.armedKey) return;
    const position = event.target?.position || null;
    const sql = readStatementHighlightSql(editor);
    const clickOffset = position ? getNormalizedOffsetAtPosition(sql, position) : null;
    const clickedOutsideArmedRange = !refs.armedRange || shouldDisarmArmedHighlightOnClick({
      armedRange: refs.armedRange,
      clickOffset,
    });
    if (!clickedOutsideArmedRange) return;
    onDisarm();
    refs.hoverRange = resolveRange(position);
    paint();
  };
  const handleEscape = (event: { keyCode?: number; preventDefault?: () => void }) => {
    if (event.keyCode !== MONACO_ESCAPE_KEY_CODE || !refs.armedKey) return;
    onDisarm();
    paint();
    event.preventDefault?.();
  };
  const host = editor.getDomNode?.();
  const handleMouseLeave = () => {
    if (refs.armedKey) return;
    refs.hoverRange = null;
    paint();
  };
  const disposables: Disposable[] = [{ dispose: () => host?.removeEventListener('mouseleave', handleMouseLeave) }];
  host?.addEventListener('mouseleave', handleMouseLeave);
  if (editor.onMouseMove) disposables.push(editor.onMouseMove((event) => mouseMove.schedule(event.target?.position || null)));
  if (editor.onMouseDown) disposables.push(editor.onMouseDown(handleMouseDown));
  if (editor.onDidScrollChange) disposables.push(editor.onDidScrollChange(paint));
  if (editor.onDidLayoutChange) disposables.push(editor.onDidLayoutChange(paint));
  if (editor.onDidChangeModel) disposables.push(editor.onDidChangeModel(handleContentChange));
  if (editor.onDidChangeModelContent) disposables.push(editor.onDidChangeModelContent(handleContentChange));
  if (editor.onDidChangeCursorPosition) disposables.push(editor.onDidChangeCursorPosition(handleCursorChange));
  if (editor.onKeyDown) disposables.push(editor.onKeyDown(handleEscape));
  disposables.push({ dispose: () => mouseMove.dispose() });
  paint();
  return disposables;
};
