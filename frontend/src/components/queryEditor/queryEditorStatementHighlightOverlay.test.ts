/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  bindStatementHighlightEditor,
  editorHasNonEmptySelection,
  hideStatementOverlay,
  paintStatementFrame,
  readStatementHighlightSql,
  type OverlayRefs,
  type StatementHighlightEditor,
} from './queryEditorStatementHighlightOverlay';

const SQL = 'SELECT 1;\nSELECT 2;';

type Listeners = {
  mouseMove?: (event: { target?: { position?: { lineNumber: number; column: number } | null } }) => void;
  mouseDown?: (event: { target?: { position?: { lineNumber: number; column: number } | null } }) => void;
  scroll?: () => void;
  layout?: () => void;
  model?: () => void;
  content?: () => void;
  cursor?: () => void;
  keyDown?: (event: { keyCode?: number; preventDefault?: () => void }) => void;
};

const createEditor = (overrides: Partial<StatementHighlightEditor> = {}) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const listeners: Listeners = {};
  let position = { lineNumber: 1, column: 1 };
  const editor: StatementHighlightEditor = {
    getDomNode: () => host,
    getModel: () => ({
      getValue: () => SQL,
      getValueInRange: () => '',
      getVersionId: () => 1,
    }),
    getPosition: () => position,
    getSelection: () => ({ isEmpty: () => true }),
    getScrolledVisiblePosition: ({ column, lineNumber }) => ({
      left: column === 1 ? 8 : 80,
      top: lineNumber === 1 ? 10 : 28,
      height: 18,
    }),
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
    onDidChangeModel: (listener) => {
      listeners.model = listener;
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
    ...overrides,
  };
  return {
    editor,
    host,
    listeners,
    setPosition: (next: { lineNumber: number; column: number }) => {
      position = next;
    },
  };
};

const createRefs = (): OverlayRefs => ({
  overlay: null,
  armedKey: null,
  armedRange: null,
  hoverRange: null,
});

afterEach(() => {
  document.body.replaceChildren();
});

describe('readStatementHighlightSql', () => {
  it('normalizes CRLF and falls back to an empty string', () => {
    expect(readStatementHighlightSql({
      getModel: () => ({ getValue: () => 'SELECT 1;\r\nSELECT 2;' }),
    })).toBe('SELECT 1;\nSELECT 2;');
    expect(readStatementHighlightSql(null)).toBe('');
  });
});

describe('editorHasNonEmptySelection', () => {
  it('requires visible selected text, not just a non-empty Monaco range', () => {
    expect(editorHasNonEmptySelection({
      getSelection: () => ({ isEmpty: () => false, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 }),
      getModel: () => ({ getValueInRange: () => '   ' }),
    })).toBe(false);
    expect(editorHasNonEmptySelection({
      getSelection: () => ({ isEmpty: () => false, startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 }),
      getModel: () => ({ getValueInRange: () => 'SELECT 1' }),
    })).toBe(true);
    expect(editorHasNonEmptySelection({
      getSelection: () => ({ isEmpty: () => false }),
      getModel: () => ({}),
    })).toBe(false);
    expect(editorHasNonEmptySelection({
      getSelection: () => ({ isEmpty: () => true }),
    })).toBe(false);
  });
});

describe('paintStatementFrame', () => {
  it('hides the overlay when painting is disabled or the range is off-screen', () => {
    const { editor, host } = createEditor({
      getScrolledVisiblePosition: () => null,
    });
    const refs = createRefs();
    refs.hoverRange = { start: 0, end: 9, text: 'SELECT 1;' };

    const hidden = paintStatementFrame(editor, refs, false);
    expect(hidden).toBeNull();

    refs.overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    hideStatementOverlay(refs.overlay);
    expect(refs.overlay.style.display).toBe('none');

    const overlay = paintStatementFrame(editor, refs, true);
    host.appendChild(overlay!);
    expect(overlay?.style.display).toBe('none');
  });
});

describe('bindStatementHighlightEditor', () => {
  it('paints hover frames, ignores hover while armed, and disarms on outside click or Escape', () => {
    const { editor, host, listeners, setPosition } = createEditor();
    const refs = createRefs();
    const onDisarm = vi.fn(() => {
      refs.armedKey = null;
      refs.armedRange = null;
    });
    const onModelInvalidated = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const disposables = bindStatementHighlightEditor({
      editor,
      getCanInteract: () => true,
      getCanPaint: () => true,
      resolveRange: (position) => (
        position?.lineNumber === 2
          ? { start: 10, end: 19, text: 'SELECT 2;' }
          : { start: 0, end: 9, text: 'SELECT 1;' }
      ),
      refs,
      onOverlay: (overlay) => {
        refs.overlay = overlay;
      },
      onDisarm,
      onModelInvalidated,
    });

    listeners.mouseMove?.({ target: { position: { lineNumber: 1, column: 1 } } });
    const overlay = host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame');
    expect(overlay?.style.display).toBe('block');
    expect(overlay?.className.baseVal || overlay?.getAttribute('class')).not.toContain('is-armed');

    refs.armedKey = '0:9:SELECT 1;';
    refs.armedRange = { start: 0, end: 9, text: 'SELECT 1;' };
    listeners.layout?.();
    expect(overlay?.className.baseVal || overlay?.getAttribute('class')).toContain('is-armed');

    listeners.mouseMove?.({ target: { position: { lineNumber: 2, column: 1 } } });
    expect(refs.hoverRange?.text).toBe('SELECT 1;');

    listeners.mouseDown?.({ target: { position: { lineNumber: 2, column: 1 } } });
    expect(onDisarm).toHaveBeenCalled();

    refs.armedKey = '0:9:SELECT 1;';
    refs.armedRange = { start: 0, end: 9, text: 'SELECT 1;' };
    const preventDefault = vi.fn();
    listeners.keyDown?.({ keyCode: 9, preventDefault });
    expect(preventDefault).toHaveBeenCalled();

    refs.armedKey = '0:9:SELECT 1;';
    setPosition({ lineNumber: 2, column: 1 });
    listeners.cursor?.();
    expect(onDisarm).toHaveBeenCalledTimes(3);

    listeners.content?.();
    expect(onModelInvalidated).toHaveBeenCalled();
    listeners.scroll?.();
    host.dispatchEvent(new Event('mouseleave'));
    expect(refs.hoverRange).toBeNull();

    disposables.forEach((item) => item.dispose());
    vi.unstubAllGlobals();
  });

  it('flushes pending hover frames through requestAnimationFrame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { editor, listeners } = createEditor();
    const refs = createRefs();
    bindStatementHighlightEditor({
      editor,
      getCanInteract: () => true,
      getCanPaint: () => true,
      resolveRange: () => ({ start: 0, end: 9, text: 'SELECT 1;' }),
      refs,
      onOverlay: (overlay) => {
        refs.overlay = overlay;
      },
      onDisarm: vi.fn(),
      onModelInvalidated: vi.fn(),
    });

    listeners.mouseMove?.({ target: { position: { lineNumber: 1, column: 1 } } });
    listeners.mouseMove?.({ target: { position: { lineNumber: 1, column: 3 } } });
    expect(refs.hoverRange).toBeNull();
    frames[0](0);
    expect(refs.hoverRange?.text).toBe('SELECT 1;');
    vi.unstubAllGlobals();
  });

  it('disarms an unframed armed shortcut on any click', () => {
    const { editor, listeners } = createEditor();
    const refs = createRefs();
    refs.armedKey = 'unframed:DELETE FROM missing';
    const onDisarm = vi.fn(() => {
      refs.armedKey = null;
    });
    bindStatementHighlightEditor({
      editor,
      getCanInteract: () => true,
      getCanPaint: () => true,
      resolveRange: () => ({ start: 0, end: 9, text: 'SELECT 1;' }),
      refs,
      onOverlay: (overlay) => {
        refs.overlay = overlay;
      },
      onDisarm,
      onModelInvalidated: vi.fn(),
    });

    listeners.mouseDown?.({ target: { position: { lineNumber: 1, column: 1 } } });
    expect(onDisarm).toHaveBeenCalled();
  });

  it('keeps a multi-statement arm while the caret stays inside it', () => {
    const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
    const armedRange = { start: 0, end: 'SELECT 1;\nSELECT 2;'.length, text: 'SELECT 1;\nSELECT 2;' };
    const { editor, listeners, setPosition } = createEditor({
      getModel: () => ({ getValue: () => sql, getVersionId: () => 1 }),
    });
    const refs = createRefs();
    refs.armedKey = '0:19:SELECT 1;\nSELECT 2;';
    refs.armedRange = armedRange;
    const onDisarm = vi.fn();
    bindStatementHighlightEditor({
      editor,
      getCanInteract: () => true,
      getCanPaint: () => true,
      resolveRange: (position) => (
        position?.lineNumber === 3
          ? { start: 20, end: sql.length, text: 'SELECT 3;' }
          : { start: 0, end: 9, text: 'SELECT 1;' }
      ),
      refs,
      onOverlay: (overlay) => {
        refs.overlay = overlay;
      },
      onDisarm,
      onModelInvalidated: vi.fn(),
    });

    setPosition({ lineNumber: 2, column: 1 });
    listeners.cursor?.();
    expect(onDisarm).not.toHaveBeenCalled();

    setPosition({ lineNumber: 3, column: 1 });
    listeners.cursor?.();
    expect(onDisarm).toHaveBeenCalledTimes(1);
  });

  it('ignores hover while the editor cannot be interacted with', () => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const { editor, listeners } = createEditor();
    const refs = createRefs();
    bindStatementHighlightEditor({
      editor,
      getCanInteract: () => false,
      getCanPaint: () => false,
      resolveRange: () => ({ start: 0, end: 9, text: 'SELECT 1;' }),
      refs,
      onOverlay: (overlay) => {
        refs.overlay = overlay;
      },
      onDisarm: vi.fn(),
      onModelInvalidated: vi.fn(),
    });

    listeners.mouseMove?.({ target: { position: { lineNumber: 1, column: 1 } } });
    expect(refs.hoverRange).toBeNull();
    vi.unstubAllGlobals();
  });
});
