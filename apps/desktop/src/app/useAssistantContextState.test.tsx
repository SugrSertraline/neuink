// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AssistantComposerEditor } from '@/modules/assistant/components/AssistantComposerEditor';
import { ActivityNavigation } from './ActivityNavigation';
import type { SidePanel } from './activityBarState';
import { useAssistantContextState } from './useAssistantContextState';

afterEach(cleanup);

it('keeps the dashboard selected when a mounted hidden composer publishes a late draft update', async () => {
  let restoreDraft!: () => void;
  const updates = vi.fn();
  function Host() {
    const [panel, setPanel] = useState<SidePanel>('assistant');
    const [question, setQuestion] = useState<string | null>(null);
    const { assistantContext, replaceAssistantContext } = useAssistantContextState();
    restoreDraft = () => setQuestion('异步恢复的问题');
    return <TooltipProvider>
      <ActivityNavigation focusedKind="daily-dashboard" activePanel={panel} noteDetails={false}
        onOpenPage={page => { if (page !== 'settings') setPanel(page); }} onOpenRight={vi.fn()} onSelectTool={setPanel} />
      <aside aria-label="当前侧栏">{panel}</aside>
      <div hidden={panel !== 'assistant'}><AssistantComposerEditor composerDraft={null} disabled={false}
        contextItems={assistantContext.items} entries={[]} tags={[]} resetKey={0} draftQuestion={question}
        onChange={(snapshot, items) => { updates(snapshot); replaceAssistantContext(items); }}
        onDraftQuestionConsumed={() => setQuestion(null)} onSubmit={vi.fn()} /></div>
    </TooltipProvider>;
  }
  const ui = render(<Host />);
  await waitFor(() => expect(ui.getByRole('textbox', { name: '输入问题' })).toBeTruthy());
  fireEvent.click(ui.getByRole('button', { name: '每日看板' }));
  await act(async () => restoreDraft());
  await waitFor(() => expect(updates).toHaveBeenCalledWith(expect.objectContaining({ text: '异步恢复的问题' })));
  expect(ui.getByLabelText('当前侧栏').textContent).toBe('daily-dashboard');
  expect(ui.getByRole('button', { name: '每日看板' }).getAttribute('aria-current')).toBe('true');
  expect(ui.getByRole('button', { name: '助手' }).getAttribute('aria-pressed')).toBe('false');
  expect(ui.container.querySelectorAll('.activitybar-group button.active')).toHaveLength(1);
  fireEvent.click(ui.getByRole('button', { name: '每日看板' }));
  expect(ui.getByLabelText('当前侧栏').textContent).toBe('daily-dashboard');
  fireEvent.click(ui.getByRole('button', { name: '助手' }));
  expect(ui.getByRole('textbox', { name: '输入问题' }).textContent).toBe('异步恢复的问题');
});
