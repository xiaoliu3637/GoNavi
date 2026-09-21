import { resolveExecutableSql } from '../../utils/sqlStatementSelection';
import {
  getNormalizedOffsetAtPosition,
  normalizeEditorPosition,
} from './QueryEditorHelpers';

type EditorPosition = { lineNumber: number; column: number };

type ExecutableSqlEditor = {
  getModel?: () => { getValue?: () => string } | null;
  getPosition?: () => EditorPosition | null;
  getSelection?: () => unknown;
};

const resolveAtPosition = (
  sql: string,
  position: unknown,
  dbType: string,
): string => {
  const normalizedPosition = normalizeEditorPosition(position);
  if (!normalizedPosition) return '';
  const offset = getNormalizedOffsetAtPosition(sql, normalizedPosition);
  return resolveExecutableSql(sql, offset, '', dbType)?.sql || '';
};

const resolveAtCurrentCursor = ({
  editor,
  sql,
  cachedPosition,
  dbType,
}: {
  editor: ExecutableSqlEditor;
  sql: string;
  cachedPosition: EditorPosition | null;
  dbType: string;
}): string => {
  const liveSelection = normalizeEditorPosition(editor.getSelection?.());
  if (liveSelection) return resolveAtPosition(sql, liveSelection, dbType);

  const livePosition = normalizeEditorPosition(editor.getPosition?.());
  const candidates = [cachedPosition, livePosition].filter(Boolean) as EditorPosition[];
  const seen = new Set<string>();
  for (const position of candidates) {
    const key = `${position.lineNumber}:${position.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const executableSql = resolveAtPosition(sql, position, dbType);
    if (executableSql.trim()) return executableSql;
  }
  return resolveAtPosition(sql, cachedPosition || livePosition, dbType);
};

export const resolveQueryEditorExecutableSql = ({
  editor,
  currentQuery,
  selectedSql,
  resultSetCount,
  lastExecutedQuery,
  cachedPosition,
  dbType,
}: {
  editor: ExecutableSqlEditor | null;
  currentQuery: string;
  selectedSql: string;
  resultSetCount: number;
  lastExecutedQuery: string;
  cachedPosition: EditorPosition | null;
  dbType: string;
}): string => {
  const selected = selectedSql.trim();
  if (
    !selected
    && resultSetCount > 0
    && lastExecutedQuery
    && currentQuery.startsWith(lastExecutedQuery)
  ) {
    const appendedSql = currentQuery.slice(lastExecutedQuery.length);
    if (appendedSql.trim()) return appendedSql;
  }
  const model = editor?.getModel?.();
  if (!model || !editor) return selectedSql || currentQuery;
  if (selected) return selectedSql;
  return resolveAtCurrentCursor({
    editor,
    sql: String(model.getValue?.() ?? currentQuery),
    cachedPosition,
    dbType,
  });
};
