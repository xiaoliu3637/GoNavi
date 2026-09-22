/** @vitest-environment jsdom */

import React, { useRef } from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
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

import {
  useQueryEditorStatementHighlight,
  type StatementHighlightEditor,
} from './useQueryEditorStatementHighlight';
import type { RunShortcutAction } from './queryEditorStatementHighlight';

const SQL = 'SELECT 1;\nSELECT id FROM users;';

type HookProps = {
  enabled?: boolean;
  requireConfirm?: boolean;
  isActive?: boolean;
  isRunning?: boolean;
  isElasticsearchMode?: boolean;
  selectedText?: string;
  executionSql?: string;
};

const createEditor = (selectedText = '', sql = SQL) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let position = { lineNumber: 2, column: 1 };
  const listeners: {
    cursorPositionChange?: () => void;
  } = {};
  const editor: StatementHighlightEditor = {
    getDomNode: () => host,
    getModel: () => ({
      getValue: () => sql,
      getValueInRange: () => selectedText,
      getVersionId: () => 1,
    }),
    getPosition: () => position,
    getSelection: () => ({
      isEmpty: () => !selectedText,
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: selectedText.length + 1,
    }),
    getScrolledVisiblePosition: ({ column }) => ({
      left: column === 1 ? 8 : 120,
      top: 20,
      height: 18,
    }),
    onMouseMove: () => ({ dispose: () => undefined }),
    onMouseDown: () => ({ dispose: () => undefined }),
    onDidScrollChange: () => ({ dispose: () => undefined }),
    onDidLayoutChange: () => ({ dispose: () => undefined }),
    onDidChangeModel: () => ({ dispose: () => undefined }),
    onDidChangeModelContent: () => ({ dispose: () => undefined }),
    onDidChangeCursorPosition: (listener) => {
      listeners.cursorPositionChange = listener;
      return { dispose: () => undefined };
    },
    onKeyDown: () => ({ dispose: () => undefined }),
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

const Probe = ({
  editor,
  editorRefObject,
  onReady,
  enabled = true,
  requireConfirm = true,
  isActive = true,
  isRunning = false,
  isElasticsearchMode = false,
  executionSql = 'SELECT id FROM users',
}: HookProps & {
  editor: StatementHighlightEditor | null;
  editorRefObject?: { current: StatementHighlightEditor | null };
  onReady: (actions: {
    arm: () => RunShortcutAction;
    run: (callback: () => void | Promise<void>) => Promise<void>;
  }) => void;
}) => {
  const localRef = useRef<StatementHighlightEditor | null>(editor);
  const editorRef = editorRefObject || localRef;
  const { runFromShortcut, tryArmOrRunFromShortcut } = useQueryEditorStatementHighlight({
    editorRef,
    enabled,
    requireConfirm,
    isActive,
    isRunning,
    isElasticsearchMode,
    dbType: 'mysql',
    getExecutionSql: () => executionSql,
  });
  onReady({
    arm: tryArmOrRunFromShortcut,
    run: runFromShortcut,
  });
  return null;
};

describe('useQueryEditorStatementHighlight lifecycle', () => {
  it('runs immediately when highlighting is off, inactive, or in Elasticsearch mode', () => {
    const { editor, host } = createEditor();
    const holder: { arm?: () => RunShortcutAction } = {};
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Probe
          editor={editor}
          enabled={false}
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    expect(holder.arm?.()).toBe('run');
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).toBeNull();

    act(() => renderer.update(
      <Probe
        editor={editor}
        isActive={false}
        onReady={(next) => { holder.arm = next.arm; }}
      />,
    ));
    expect(holder.arm?.()).toBe('run');

    act(() => renderer.update(
      <Probe
        editor={editor}
        isElasticsearchMode
        onReady={(next) => { holder.arm = next.arm; }}
      />,
    ));
    expect(holder.arm?.()).toBe('run');
    act(() => renderer.unmount());
  });

  it('arms confirmation when the editor has a real selection', () => {
    const { editor, host } = createEditor('SELECT 1;');
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          selectedText="SELECT 1;"
          executionSql="SELECT 1;"
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    expect(holder.arm?.()).toBe('arm');
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).not.toBeNull();
    expect(holder.arm?.()).toBe('run');
  });

  it('still clears the frame when the run callback rejects', async () => {
    const { editor, host } = createEditor();
    const holder: { run?: (callback: () => void | Promise<void>) => Promise<void> } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          requireConfirm={false}
          onReady={(next) => { holder.run = next.run; }}
        />,
      );
    });

    await expect(holder.run?.(async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(host.querySelector<SVGSVGElement>('.gonavi-query-editor-statement-frame')?.style.display)
      .toBe('none');
  });

  it('attaches once the Monaco editor becomes available', () => {
    const { editor, host } = createEditor();
    const editorRef = { current: null as StatementHighlightEditor | null };
    const holder: { arm?: () => RunShortcutAction } = {};
    vi.useFakeTimers();
    act(() => {
      create(
        <Probe
          editor={null}
          editorRefObject={editorRef}
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    editorRef.current = editor;
    act(() => {
      vi.advanceTimersByTime(80);
    });
    expect(holder.arm?.()).toBe('arm');
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).not.toBeNull();
    vi.useRealTimers();
  });

  it('arms unframed execution SQL until the second shortcut press', () => {
    const { editor, host } = createEditor();
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          executionSql="DELETE FROM missing"
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    expect(holder.arm?.()).toBe('arm');
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).toBeNull();
    expect(holder.arm?.()).toBe('run');
  });

  it('notifies when an unframed target is armed', () => {
    const { editor } = createEditor();
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          executionSql="DELETE FROM missing"
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    holder.arm?.();
    expect(vi.mocked(message.info)).toHaveBeenCalled();
  });

  it('runs unframed execution SQL immediately when confirmation is off', () => {
    vi.mocked(message.info).mockClear();
    const { editor } = createEditor();
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          requireConfirm={false}
          executionSql="DELETE FROM missing"
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    expect(holder.arm?.()).toBe('run');
    expect(vi.mocked(message.info)).not.toHaveBeenCalled();
  });

  it('keeps a multi-statement confirmation while the caret stays inside the framed span', () => {
    const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
    const { editor, listeners, setPosition } = createEditor('', sql);
    setPosition({ lineNumber: 1, column: 1 });
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          executionSql={'SELECT 1;\nSELECT 2;'}
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });

    expect(holder.arm?.()).toBe('arm');
    setPosition({ lineNumber: 2, column: 2 });
    act(() => listeners.cursorPositionChange?.());
    expect(holder.arm?.()).toBe('run');
  });

  it('asks for confirmation again after the caret leaves a multi-statement frame', () => {
    const sql = 'SELECT 1;\nSELECT 2;\nSELECT 3;';
    const { editor, listeners, setPosition } = createEditor('', sql);
    setPosition({ lineNumber: 1, column: 1 });
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          executionSql={'SELECT 1;\nSELECT 2;'}
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });

    expect(holder.arm?.()).toBe('arm');
    setPosition({ lineNumber: 3, column: 1 });
    act(() => listeners.cursorPositionChange?.());
    expect(holder.arm?.()).toBe('arm');
  });

  it('drops confirmation when the tab becomes inactive', () => {
    const { editor, host } = createEditor();
    const holder: { arm?: () => RunShortcutAction } = {};
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(
        <Probe
          editor={editor}
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    expect(holder.arm?.()).toBe('arm');
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).not.toBeNull();

    act(() => renderer.update(
      <Probe
        editor={editor}
        isActive={false}
        onReady={(next) => { holder.arm = next.arm; }}
      />,
    ));
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).toBeNull();
    expect(holder.arm?.()).toBe('run');
    act(() => renderer.unmount());
  });

  it('runs blank SQL immediately and does not ask for confirmation', () => {
    vi.mocked(message.info).mockClear();
    const { editor } = createEditor('', '   \n');
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          executionSql={'   \n'}
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    expect(holder.arm?.()).toBe('run');
    expect(vi.mocked(message.info)).not.toHaveBeenCalled();
  });

  it('confirms a partial selection without framing a larger statement', () => {
    vi.mocked(message.info).mockClear();
    const { editor, host } = createEditor('', 'SELECT 1 FROM t;');
    const holder: { arm?: () => RunShortcutAction } = {};
    act(() => {
      create(
        <Probe
          editor={editor}
          executionSql="1 FROM"
          onReady={(next) => { holder.arm = next.arm; }}
        />,
      );
    });
    expect(holder.arm?.()).toBe('arm');
    expect(host.querySelector('.gonavi-query-editor-statement-frame.is-armed')).toBeNull();
    expect(vi.mocked(message.info)).toHaveBeenCalledTimes(1);
    expect(holder.arm?.()).toBe('run');
    expect(vi.mocked(message.info)).toHaveBeenCalledTimes(1);
  });

  it('re-arms when the unframed target changes before the second press', () => {
    vi.mocked(message.info).mockClear();
    const { editor } = createEditor();
    const holder: { arm?: () => RunShortcutAction } = {};
    let renderer!: ReturnType<typeof create>;
    const render = (executionSql: string) => (
      <Probe
        editor={editor}
        executionSql={executionSql}
        onReady={(next) => { holder.arm = next.arm; }}
      />
    );
    act(() => {
      renderer = create(render('DELETE FROM a'));
    });
    expect(holder.arm?.()).toBe('arm');
    act(() => renderer.update(render('DELETE FROM b')));
    expect(holder.arm?.()).toBe('arm');
    expect(vi.mocked(message.info)).toHaveBeenCalledTimes(2);
    expect(holder.arm?.()).toBe('run');
    act(() => renderer.unmount());
  });
});
