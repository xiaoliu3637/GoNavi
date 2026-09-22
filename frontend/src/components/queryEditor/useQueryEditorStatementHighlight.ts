import { useCallback, useEffect, useRef } from 'react';

import type { SqlStatementRange } from '../../utils/sqlStatementSelection';
import { getNormalizedOffsetAtPosition } from './QueryEditorHelpers';
import {
  findHighlightableStatementRanges,
  resolveExecutionSqlHighlightRange,
  resolveHighlightableRangeFromRanges,
  resolveRunShortcutAction,
  resolveShortcutStatementKey,
  type RunShortcutAction,
} from './queryEditorStatementHighlight';
import {
  bindStatementHighlightEditor,
  paintStatementFrame,
  readStatementHighlightSql,
  type OverlayRefs,
  type StatementHighlightEditor,
} from './queryEditorStatementHighlightOverlay';
import { notifyUnframedStatementRunArmed } from './queryEditorStatementHighlightNotify';
import './queryEditorStatementHighlight.css';

export type { StatementHighlightEditor } from './queryEditorStatementHighlightOverlay';

type UseQueryEditorStatementHighlightArgs = {
  editorRef: { current: StatementHighlightEditor | null };
  enabled: boolean;
  requireConfirm: boolean;
  isActive: boolean;
  isRunning: boolean;
  isElasticsearchMode: boolean;
  dbType: string;
  getExecutionSql: () => string;
};

type RangeCache = {
  sql: string;
  dbType: string;
  modelVersion: number;
  statementRanges: SqlStatementRange[];
  offsets: Map<number, SqlStatementRange | null>;
};

const EMPTY_RANGE_CACHE: RangeCache = {
  sql: '',
  dbType: '',
  modelVersion: -1,
  statementRanges: [],
  offsets: new Map(),
};

const resolveRangeAtPosition = (
  editor: StatementHighlightEditor | null,
  position: { lineNumber: number; column: number } | null,
  dbType: string,
  cache: RangeCache,
): SqlStatementRange | null => {
  if (!editor || !position) return null;
  const sql = readStatementHighlightSql(editor);
  const modelVersion = Number(editor.getModel?.()?.getVersionId?.() ?? -1);
  if (cache.sql !== sql || cache.dbType !== dbType || cache.modelVersion !== modelVersion) {
    cache.sql = sql;
    cache.dbType = dbType;
    cache.modelVersion = modelVersion;
    cache.statementRanges = findHighlightableStatementRanges(sql, dbType);
    cache.offsets.clear();
  }
  const offset = getNormalizedOffsetAtPosition(sql, position);
  if (cache.offsets.has(offset)) return cache.offsets.get(offset) || null;
  const range = resolveHighlightableRangeFromRanges(sql, cache.statementRanges, offset);
  if (cache.offsets.size >= 256) cache.offsets.clear();
  cache.offsets.set(offset, range);
  return range;
};

const useStatementHighlightBinding = ({
  editorRef,
  featureOn,
  stateRefs,
  rangeCacheRef,
  dbTypeRef,
  isRunningRef,
  clearArmed,
}: {
  editorRef: { current: StatementHighlightEditor | null };
  featureOn: boolean;
  stateRefs: OverlayRefs;
  rangeCacheRef: { current: RangeCache };
  dbTypeRef: { current: string };
  isRunningRef: { current: boolean };
  clearArmed: () => void;
}) => {
  useEffect(() => {
    if (!featureOn) {
      stateRefs.overlay?.remove();
      stateRefs.overlay = null;
      return undefined;
    }
    let disposed = false;
    let disposables: Array<{ dispose: () => void }> = [];
    let attachTimer: number | null = null;
    const detach = () => {
      disposables.forEach((item) => item.dispose());
      disposables = [];
    };
    const tryAttach = () => {
      const editor = editorRef.current;
      if (disposed || !editor) return false;
      detach();
      disposables = bindStatementHighlightEditor({
        editor,
        getCanInteract: () => featureOn && !isRunningRef.current,
        getCanPaint: () => featureOn && (!isRunningRef.current || Boolean(stateRefs.armedRange)),
        resolveRange: (position) => resolveRangeAtPosition(
          editor, position, dbTypeRef.current, rangeCacheRef.current,
        ),
        refs: stateRefs,
        onOverlay: (overlay) => { stateRefs.overlay = overlay; },
        onDisarm: clearArmed,
        onModelInvalidated: () => {
          rangeCacheRef.current = { ...EMPTY_RANGE_CACHE, statementRanges: [], offsets: new Map() };
        },
      });
      return true;
    };
    if (!tryAttach() && typeof window !== 'undefined') {
      attachTimer = window.setInterval(() => {
        if (tryAttach() && attachTimer !== null) {
          window.clearInterval(attachTimer);
          attachTimer = null;
        }
      }, 40);
    }
    return () => {
      disposed = true;
      if (attachTimer !== null) window.clearInterval(attachTimer);
      detach();
      stateRefs.overlay?.remove();
      stateRefs.overlay = null;
    };
  }, [clearArmed, dbTypeRef, editorRef, featureOn, isRunningRef, rangeCacheRef, stateRefs]);
};

export const useQueryEditorStatementHighlight = ({
  editorRef,
  enabled,
  requireConfirm,
  isActive,
  isRunning,
  isElasticsearchMode,
  dbType,
  getExecutionSql,
}: UseQueryEditorStatementHighlightArgs) => {
  const overlayRef = useRef<SVGSVGElement | null>(null);
  const armedKeyRef = useRef<string | null>(null);
  const armedRangeRef = useRef<SqlStatementRange | null>(null);
  const hoverRangeRef = useRef<SqlStatementRange | null>(null);
  const rangeCacheRef = useRef<RangeCache>({
    ...EMPTY_RANGE_CACHE,
    statementRanges: [],
    offsets: new Map(),
  });
  const wasRunningRef = useRef(false);
  const dbTypeRef = useRef(dbType);
  const isRunningRef = useRef(isRunning);
  const executionSqlRef = useRef(getExecutionSql);
  dbTypeRef.current = dbType;
  isRunningRef.current = isRunning;
  executionSqlRef.current = getExecutionSql;
  const featureOn = enabled && isActive && !isElasticsearchMode;
  const stateRefs = useRef<OverlayRefs>({
    get overlay() { return overlayRef.current; },
    set overlay(value) { overlayRef.current = value; },
    get armedKey() { return armedKeyRef.current; },
    set armedKey(value) { armedKeyRef.current = value; },
    get armedRange() { return armedRangeRef.current; },
    set armedRange(value) { armedRangeRef.current = value; },
    get hoverRange() { return hoverRangeRef.current; },
    set hoverRange(value) { hoverRangeRef.current = value; },
  }).current;
  const clearArmed = useCallback(() => {
    armedKeyRef.current = null;
    armedRangeRef.current = null;
  }, []);
  const clearHighlight = useCallback(() => {
    clearArmed();
    hoverRangeRef.current = null;
    overlayRef.current = paintStatementFrame(editorRef.current, stateRefs, false);
  }, [clearArmed, editorRef, stateRefs]);
  const tryArmOrRunFromShortcut = useCallback((): RunShortcutAction => {
    const editor = editorRef.current;
    if (!featureOn) {
      clearArmed();
      return 'run';
    }
    const sql = readStatementHighlightSql(editor);
    const position = editor?.getPosition?.() || null;
    const offset = position ? getNormalizedOffsetAtPosition(sql, position) : 0;
    const executionSql = executionSqlRef.current();
    const range = resolveExecutionSqlHighlightRange(
      sql, executionSql, offset, dbTypeRef.current,
    );
    const statementKey = resolveShortcutStatementKey({ range, executionSql });
    const action = resolveRunShortcutAction({
      enabled: true, requireConfirm, statementKey, armedKey: armedKeyRef.current,
    });
    if (action === 'run' && !range) {
      clearHighlight();
      return 'run';
    }
    armedKeyRef.current = statementKey;
    armedRangeRef.current = range;
    hoverRangeRef.current = null;
    overlayRef.current = paintStatementFrame(editor, stateRefs, Boolean(range));
    if (action === 'arm' && !range) {
      notifyUnframedStatementRunArmed();
    }
    return action;
  }, [clearArmed, clearHighlight, editorRef, featureOn, requireConfirm, stateRefs]);
  const runFromShortcut = useCallback(async (run: () => void | Promise<void>) => {
    if (tryArmOrRunFromShortcut() === 'arm') return;
    try {
      await run();
    } finally {
      clearHighlight();
    }
  }, [clearHighlight, tryArmOrRunFromShortcut]);

  useEffect(() => {
    const runCompleted = wasRunningRef.current && !isRunning;
    wasRunningRef.current = isRunning;
    if (runCompleted) clearArmed();
    const canPaint = featureOn && (!isRunning || Boolean(armedRangeRef.current));
    if (!canPaint) {
      hoverRangeRef.current = null;
      clearArmed();
    }
    overlayRef.current = paintStatementFrame(editorRef.current, stateRefs, canPaint);
  }, [clearArmed, editorRef, featureOn, isRunning, stateRefs]);

  useStatementHighlightBinding({
    editorRef, featureOn, stateRefs, rangeCacheRef, dbTypeRef, isRunningRef, clearArmed,
  });
  return { runFromShortcut, tryArmOrRunFromShortcut };
};
