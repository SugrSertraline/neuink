// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surfaceKey, type WorkspaceSurface, type WorkspaceSurfaceLayout } from '@/app/workspaceSurface';
import { WorkspaceSurfaceDeck } from '@/modules/reader/components/WorkspaceSurfaceDeck';
import type { EntryMeta } from '@/shared/types/domain';
import { OnboardingGuide } from './OnboardingGuide';
import { freshProgress, GUIDE_STORAGE_KEY, openOnboarding } from './progress';

vi.mock('@/shared/hooks/useToast', () => ({ useToast:() => ({ notify:vi.fn(), dismiss:vi.fn() }) }));
const demo: EntryMeta = { id:'z-demo', title:'演示论文', fields:{ tutorial_demo:'attention-v1' }, tags:[],
  contents:[{ kind:'note', note_id:'latest', title:'演示笔记' }], created_at:'2026-10-01', updated_at:'2026-10-01',
  pdf:{ file_name:'demo.pdf', content_hash:'demo', imported_at:'2026-10-01',
    parse:{ status:'succeeded', updated_at:'2026-10-01', message:null, task_id:null, endpoint:null } } };
const box = (x:number, width:number) => ({ left:x, top:100, right:x + width, bottom:700, width, height:600 } as DOMRect);

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback:FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', window.clearTimeout.bind(window));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1200);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this:HTMLElement) {
    if (this.closest('[data-workspace-surface-key]')) return box(this.closest('[data-workspace-drop-pane="right"]') ? 700 : 20, 450);
    return { left:0, top:0, right:1200, bottom:800, width:1200, height:800 } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.querySelectorAll('[data-test-popup]').forEach(node => node.remove()); });

function fixture(id:string, user:WorkspaceSurface, teaching:WorkspaceSurface) {
  localStorage.setItem(GUIDE_STORAGE_KEY, JSON.stringify({ ...freshProgress(), seen:true, current:id, root:'test', entryId:demo.id }));
  const layout:WorkspaceSurfaceLayout = { left:user, leftTabs:[user], right:teaching, rightTabs:[teaching], focusedPane:'right' };
  const userAction = vi.fn(), demoAction = vi.fn(), popupAction = vi.fn();
  const popup = document.createElement('div'); popup.className = 'app-floating-segment-panel'; popup.dataset.testPopup = '';
  const popupButton = document.createElement('button'); popupButton.textContent = '保存演示片段';
  popupButton.addEventListener('click', popupAction); popup.append(popupButton);
  const onRoute = vi.fn();
  const view = render(<><WorkspaceSurfaceDeck layout={layout} onFocus={() => undefined} renderSurface={surface => {
    const own = surfaceKey(surface) === surfaceKey(teaching);
    const action = own ? demoAction : userAction;
    return surface.kind === 'note'
      ? <div className="markdown-note-scroll"><div className="tiptap" contentEditable suppressContentEditableWarning
          onPointerDown={action} onKeyDown={action}>{own ? '演示笔记正文' : '用户笔记正文'}</div></div>
      : <div data-pdf-page-surface onContextMenu={() => { action(); if (own) document.body.append(popup); }}>
          <div data-guide="pdf-page"><canvas data-pdf-rendered="true" /><div className="pdf-text-layer">
            <span onPointerDown={action}>{own ? '演示 PDF 正文' : '用户 PDF 正文'}</span></div></div>
          <div data-segment-uid={own ? 'demo-segment' : 'user-segment'} title="段落" />
        </div>;
  }} /><OnboardingGuide root="test" ready entries={[demo]} selectedEntryId={demo.id} layout={layout}
    onRoute={onRoute} onImportSample={async () => demo.id} /></>);
  act(() => openOnboarding());
  return { ...view, userAction, demoAction, popupAction, onRoute };
}

describe('onboarding with two visible reading surfaces', () => {
  it.each(['annotation', 'segment-note', 'source-note'])('scopes %s geometry and real actions to the demo when a user PDF comes first', async id => {
    const result = fixture(id, { kind:'pdf', entryId:'a-user' }, { kind:'pdf', entryId:demo.id, viewId:'teaching' });
    await waitFor(() => expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('x')).toBe('696'));
    expect(result.container.querySelector('[data-workspace-surface-key]')?.getAttribute('data-workspace-surface-key')).toBe('pdf:a-user');
    const user = screen.getByText('用户 PDF 正文'), teaching = screen.getByText('演示 PDF 正文');
    expect(fireEvent.pointerDown(user)).toBe(false);
    expect(fireEvent.contextMenu(user)).toBe(false);
    expect(result.userAction).not.toHaveBeenCalled();
    expect(fireEvent.pointerDown(teaching)).toBe(true);
    expect(result.demoAction).toHaveBeenCalledOnce();
    expect(result.onRoute).toHaveBeenLastCalledWith(id === 'source-note' ? 'pdf-note' : 'pdf', demo.id);
    if (id === 'segment-note') {
      fireEvent.contextMenu(teaching);
      await waitFor(() => expect(document.querySelector('[data-guide-popup-window]')).toBeTruthy());
      fireEvent.click(screen.getByText('保存演示片段'));
      expect(result.popupAction).toHaveBeenCalledOnce();
    }
  });

  it.each(['a-user', 'z-demo'])('keeps write-note off a preceding note owned by %s', async entryId => {
    const result = fixture('write-note', { kind:'note', entryId, noteId:'earlier' },
      { kind:'note', entryId:demo.id, noteId:'latest', viewId:'teaching' });
    await waitFor(() => expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('x')).toBe('696'));
    expect(fireEvent.pointerDown(screen.getByText('用户笔记正文'))).toBe(false);
    expect(fireEvent.keyDown(screen.getByText('用户笔记正文'), { key:'s', ctrlKey:true })).toBe(false);
    expect(result.userAction).not.toHaveBeenCalled();
    expect(fireEvent.pointerDown(screen.getByText('演示笔记正文'))).toBe(true);
    expect(fireEvent.keyDown(screen.getByText('演示笔记正文'), { key:'s', ctrlKey:true })).toBe(true);
    expect(result.demoAction).toHaveBeenCalledTimes(2);
  });

  it.each(['blocks', 'selection-translation'])('anchors the automatic %s demonstration to the same demo view', async id => {
    fixture(id, { kind:'pdf', entryId:'a-user' }, { kind:'pdf', entryId:demo.id, viewId:'teaching' });
    await waitFor(() => expect(document.querySelector('[data-guide-pdf-demo] > div')?.getAttribute('style')).toContain('left: 700px'));
    expect(document.querySelector('[data-guide-spotlight-window]')?.getAttribute('x')).toBe('696');
    if (id === 'selection-translation') {
      expect(screen.getByRole('region', { name:'选区操作演示（不执行操作）' }).textContent).toContain('演示 PDF 正文');
      expect(screen.getByRole('region', { name:'选区操作演示（不执行操作）' }).textContent).not.toContain('用户 PDF 正文');
    }
  });
});
