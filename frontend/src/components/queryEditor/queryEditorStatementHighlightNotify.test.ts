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

import { notifyUnframedStatementRunArmed } from './queryEditorStatementHighlightNotify';

describe('notifyUnframedStatementRunArmed', () => {
  it('explains that the next run will execute the unframed SQL', () => {
    notifyUnframedStatementRunArmed();
    expect(message.info).toHaveBeenCalledWith('query_editor.message.statement_run_confirm_unframed');
  });
});
