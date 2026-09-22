/** @vitest-environment jsdom */

import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import {
  useQueryEditorStatementHighlight,
  type StatementHighlightEditor,
} from './useQueryEditorStatementHighlight';
import type { RunShortcutAction } from './queryEditorStatementHighlight';

const SQL = 'SELECT 1;\nSELECT id FROM users;';

type EditorListeners = {
  contentChange?: () => void;
  cursorPositionChange?: () => void;
  layoutChange?: () => void;
  modelChange?: () => void;
  mouseDown?: (event: {
    target?: { position?: { lineNumber: number; column: number } | null };
  }) => void;
  mouseMove?: (event: {
    target?: { position?: { lineNumber: number; column: number } | null };
  }) => void;
  keyDown?: (event: { keyCode?: number; preventDefault?: () => void }) => void;
};

const createEditor = (): {
  editor: StatementHighlightEditor;
  host: HTMLDivElement;
  listeners: EditorListeners;
  setPosition: (position: { lineNumber: number; column: number }) => void;
} => {
  const host = document.createElement('div');
  const listeners: EditorListeners = {};
  let position = { lineNumber: 2, column: 1 };
  document.body.appendChild(host);
  const editor: StatementHighlightEditor = {
    getDomNode: () => host,
    getModel: () => ({
      getValue: () => SQL,
      getValueInRange: () => '',
    }),
    getPosition: () => position,
    getSelection: () => ({ isEmpty: () => true }),
    getScrolledVisiblePosition: ({ column }) => ({
      left: column === 1 ? 8 : 120,
      top: 20,
      height: 18,
    }),
    onMouseMove: (listener) => {
      listeners.mouseMove = listener;
      return { dispose: () => undefined };
    },
    onMouseDown: (listener) => {
      listeners.mouseDown = listener;
      return { dispose: () => undefined };
    },
    onDidScrollChange: () => ({ dispose: () => undefined }),
    onDidLayoutChange: (listener) => {
      listeners.layoutChange = listener;
      return { dispose: () => undefined };
    },
    onDidChangeModel: (listener) => {
      listeners.modelChange = listener;
      return { dispose: () => undefined };
    },
    onDidChangeModelContent: (listener) => {
      listeners.contentChange = listener;
      return { dispose: () => undefined };
    },
    onDidChangeCursorPosition: (listener) => {
      listeners.cursorPositionChange = listener;
      return { dispose: () => undefined };
    },
    onKeyDown: (listener) => {
      listeners.keyDown = listener;
      return { dispose: () => undefined };
    },
  };
  return {
    editor,
    host,
    listeners,
    setPosition: (next: { lineNumber: number; column: number }) => { position = next; },
  };
};

const Probe = ({
  editor,
  requireConfirm,
  isRunning,
  onReady,
}: {
  editor: StatementHighlightEditor;
  requireConfirm: boolean;
  isRunning: boolean;
  onReady: (actions: {
    arm: () => RunShortcutAction;
    run: (callback: () => void | Promise<void>) => Promise<void>;
  }) => void;
}) => {
  const editorRef = useRef<StatementHighlightEditor | null>(editor);
  const {
    runFromShortcut,
    tryArmOrRunFromShortcut,
  } = useQueryEditorStatementHighlight({
    editorRef,
    enabled: true,
    requireConfirm,
    isActive: true,
    isRunning,
    isElasticsearchMode: false,
    dbType: 'mysql',
    getExecutionSql: () => 'SELECT id FROM users',
  });
  onReady({
    arm: tryArmOrRunFromShortcut,
    run: runFromShortcut,
  });
  return null;
};

const mountProbe = (requireConfirm: boolean) => {
  const { editor, host, listeners, setPosition } = createEditor();
  const holder: {
    arm: (() => RunShortcutAction) | null;
    run: ((callback: () => void | Promise<void>) => Promise<void>) | null;
  } = { arm: null, run: null };
  let renderer!: ReturnType<typeof create>;
  const renderProbe = (isRunning: boolean) => (
    <Probe
      editor={editor}
      requireConfirm={requireConfirm}
      isRunning={isRunning}
      onReady={(next) => {
        holder.arm = next.arm;
        holder.run = next.run;
      }}
    />
  );
  act(() => {
    renderer = create(renderProbe(false));
  });
  return {
    holder,
    host,
    listeners,
    setPosition,
    setRunning: (isRunning: boolean) => act(() => renderer.update(renderProbe(isRunning))),
    unmount: () => act(() => renderer.unmount()),
  };
};

describe('useQueryEditorStatementHighlight', () => {
  it('arms on the first shortcut and runs on the second when confirmation is on', () => {
    const { holder, host } = mountProbe(true);

    expect(holder.arm?.()).toBe('arm');
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).not.toBeNull();
    expect(holder.arm?.()).toBe('run');
  });

  it('highlights and runs on a single shortcut press when confirmation is off', () => {
    const { holder, host, setRunning } = mountProbe(false);

    expect(holder.arm?.()).toBe('run');
    const overlay = host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame.is-armed');
    expect(overlay).not.toBeNull();

    setRunning(true);
    expect(overlay?.style.display).toBe('block');

    setRunning(false);
    expect(overlay?.style.display).toBe('none');
  });

  it('clears a shortcut highlight when execution exits before running', async () => {
    const { holder, host } = mountProbe(false);

    await holder.run?.(() => {
      expect(host.querySelector<SVGSVGElement>(
        '.gonavi-query-editor-statement-frame',
      )?.style.display).toBe('block');
    });
    const overlay = host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame');
    expect(overlay?.style.display).toBe('none');
  });

  it('does not restore hover highlighting after an armed run is disarmed', () => {
    const { holder, host, listeners, setRunning } = mountProbe(false);

    expect(holder.arm?.()).toBe('run');
    const overlay = host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame');
    setRunning(true);

    act(() => listeners.contentChange?.());
    expect(overlay?.style.display).toBe('none');

    act(() => listeners.mouseMove?.({
      target: { position: { lineNumber: 2, column: 1 } },
    }));
    expect(overlay?.style.display).toBe('none');
  });

  it('disarms confirmation when the cursor moves to another statement', () => {
    const { holder, host, listeners, setPosition } = mountProbe(true);

    expect(holder.arm?.()).toBe('arm');
    const overlay = host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame');
    expect(overlay?.style.display).toBe('block');

    setPosition({ lineNumber: 1, column: 1 });
    act(() => listeners.cursorPositionChange?.());
    expect(overlay?.style.display).toBe('none');
  });

  it('keeps confirmation armed when clicking inside the same statement', () => {
    const { holder, host, listeners } = mountProbe(true);

    expect(holder.arm?.()).toBe('arm');
    act(() => listeners.mouseDown?.({ target: { position: { lineNumber: 2, column: 5 } } }));
    act(() => listeners.cursorPositionChange?.());

    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).not.toBeNull();
    expect(holder.arm?.()).toBe('run');
  });

  it('repaints on layout changes and clears on model changes', () => {
    const { holder, host, listeners } = mountProbe(true);

    expect(holder.arm?.()).toBe('arm');
    const overlay = host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame');
    act(() => listeners.layoutChange?.());
    expect(overlay?.style.display).toBe('block');

    act(() => listeners.modelChange?.());
    expect(overlay?.style.display).toBe('none');
  });

  it('clears confirmation on Escape and removes the overlay on unmount', () => {
    const { holder, host, listeners, unmount } = mountProbe(true);
    const preventDefault = vi.fn();

    expect(holder.arm?.()).toBe('arm');
    act(() => listeners.keyDown?.({ keyCode: 9, preventDefault }));
    expect(preventDefault).toHaveBeenCalled();
    expect(host.querySelector<SVGSVGElement>(
      '.gonavi-query-editor-statement-frame',
    )?.style.display).toBe('none');

    unmount();
    expect(host.querySelector('.gonavi-query-editor-statement-frame')).toBeNull();
  });

  it('disarms confirmation when clicking outside the framed statement', () => {
    const { holder, host, listeners } = mountProbe(true);

    expect(holder.arm?.()).toBe('arm');
    act(() => listeners.mouseDown?.({ target: { position: { lineNumber: 1, column: 1 } } }));
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).toBeNull();
    expect(holder.arm?.()).toBe('arm');
  });

  it('does not hide an armed frame on mouse leave', () => {
    const { holder, host } = mountProbe(true);

    expect(holder.arm?.()).toBe('arm');
    act(() => {
      host.dispatchEvent(new Event('mouseleave'));
    });
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).not.toBeNull();
  });
});
