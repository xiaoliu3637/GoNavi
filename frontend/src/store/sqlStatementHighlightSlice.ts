import {
  DEFAULT_CONFIRM_SQL_STATEMENT_RUN,
  DEFAULT_HIGHLIGHT_CURRENT_SQL_STATEMENT,
  sanitizeConfirmSqlStatementRun,
  sanitizeHighlightCurrentSqlStatement,
} from '../utils/sqlEditorStatementHighlightSetting';

export interface SqlStatementHighlightSettings {
  highlightCurrentSqlStatement: boolean;
  confirmSqlStatementRun: boolean;
}

export interface SqlStatementHighlightSlice {
  sqlStatementHighlight: SqlStatementHighlightSettings;
  setSqlStatementHighlightSettings: (
    settings: Partial<SqlStatementHighlightSettings>,
  ) => void;
}

export const DEFAULT_SQL_STATEMENT_HIGHLIGHT_SETTINGS: SqlStatementHighlightSettings = {
  highlightCurrentSqlStatement: DEFAULT_HIGHLIGHT_CURRENT_SQL_STATEMENT,
  confirmSqlStatementRun: DEFAULT_CONFIRM_SQL_STATEMENT_RUN,
};

export const sanitizeSqlStatementHighlightSettings = (
  settings: Partial<SqlStatementHighlightSettings> | undefined,
): SqlStatementHighlightSettings => ({
  highlightCurrentSqlStatement: sanitizeHighlightCurrentSqlStatement(
    settings?.highlightCurrentSqlStatement,
  ),
  confirmSqlStatementRun: sanitizeConfirmSqlStatementRun(
    settings?.confirmSqlStatementRun,
  ),
});

const isSettingsRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readPersistedHighlightField = (
  source: Record<string, unknown> | undefined,
  key: keyof SqlStatementHighlightSettings,
): boolean | undefined => {
  if (!source || !Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
};

export const resolvePersistedSqlStatementHighlightSettings = (
  settings: unknown,
  legacyAppearance?: unknown,
): SqlStatementHighlightSettings => {
  const slice = isSettingsRecord(settings) ? settings : undefined;
  const legacy = isSettingsRecord(legacyAppearance) ? legacyAppearance : undefined;
  return sanitizeSqlStatementHighlightSettings({
    highlightCurrentSqlStatement: readPersistedHighlightField(slice, 'highlightCurrentSqlStatement')
      ?? readPersistedHighlightField(legacy, 'highlightCurrentSqlStatement'),
    confirmSqlStatementRun: readPersistedHighlightField(slice, 'confirmSqlStatementRun')
      ?? readPersistedHighlightField(legacy, 'confirmSqlStatementRun'),
  });
};

type SliceStateSetter = (
  update: (
    state: SqlStatementHighlightSlice,
  ) => Partial<SqlStatementHighlightSlice>,
) => void;

export const createSqlStatementHighlightSlice = (
  set: SliceStateSetter,
): SqlStatementHighlightSlice => ({
  sqlStatementHighlight: { ...DEFAULT_SQL_STATEMENT_HIGHLIGHT_SETTINGS },
  setSqlStatementHighlightSettings: (settings) => {
    set((state) => ({
      sqlStatementHighlight: sanitizeSqlStatementHighlightSettings({
        highlightCurrentSqlStatement:
          settings.highlightCurrentSqlStatement
          ?? state.sqlStatementHighlight.highlightCurrentSqlStatement,
        confirmSqlStatementRun:
          settings.confirmSqlStatementRun
          ?? state.sqlStatementHighlight.confirmSqlStatementRun,
      }),
    }));
  },
});
