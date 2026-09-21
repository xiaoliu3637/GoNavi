import { Switch } from 'antd';

import { useI18n } from '../../i18n/provider';
import { useStore } from '../../store';

export const WorkspaceSqlStatementHighlightSection = () => {
  const { t } = useI18n();
  const enabled = useStore((state) => state.sqlStatementHighlight.highlightCurrentSqlStatement);
  const confirmRun = useStore((state) => state.sqlStatementHighlight.confirmSqlStatementRun);
  const setHighlightSettings = useStore((state) => state.setSqlStatementHighlightSettings);

  return (
    <section className="gonavi-settings-section">
      <div className="gonavi-settings-section-title">{t('app.theme.sql_editor.title')}</div>
      <div>
        <div className="gonavi-settings-row">
          <div>
            <div className="gonavi-settings-label">{t('app.theme.sql_statement_highlight')}</div>
            <div className="gonavi-settings-label-hint">{t('app.theme.sql_statement_highlight_hint')}</div>
          </div>
          <div className="gonavi-settings-control">
            <Switch
              checked={enabled}
              onChange={(checked) => setHighlightSettings({ highlightCurrentSqlStatement: checked })}
            />
          </div>
        </div>
        <div className="gonavi-settings-row">
          <div>
            <div className="gonavi-settings-label">{t('app.theme.sql_statement_run_confirm')}</div>
            <div className="gonavi-settings-label-hint">{t('app.theme.sql_statement_run_confirm_hint')}</div>
          </div>
          <div className="gonavi-settings-control">
            <Switch
              checked={confirmRun}
              disabled={!enabled}
              onChange={(checked) => setHighlightSettings({ confirmSqlStatementRun: checked })}
            />
          </div>
        </div>
      </div>
    </section>
  );
};
