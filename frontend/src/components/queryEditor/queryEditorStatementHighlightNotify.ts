import { message } from 'antd';

import { t } from '../../i18n';

export const notifyUnframedStatementRunArmed = () => {
  message.info(t('query_editor.message.statement_run_confirm_unframed'));
};
