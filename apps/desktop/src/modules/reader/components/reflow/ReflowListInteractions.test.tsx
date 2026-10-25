// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastContext } from '@/shared/hooks/useToast';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SourceSegment } from '@/shared/types/domain';
import { pdfBlockDrag } from '@/shared/lib/pdfBlockDrag';
import { ReflowSegmentGroupView } from './ReflowSegmentGroupView';
import { buildReflowSegmentGroups } from './buildReflowBlocks';

const list: SourceSegment = { uid: 'list', segment_type: 'list', page_idx: 0, bbox: null,
  text: 'Alpha\nBeta', markdown: '- Alpha\n- Beta' };
function setup() {
  const activate = vi.fn(), attach = vi.fn(), copy = vi.fn(), note = vi.fn();
  const view = render(<TooltipProvider><ToastContext.Provider value={{ dismiss: vi.fn(), notify: () => 'test' }}>
    <ReflowSegmentGroupView active={false} flashed={false} entryId="entry" workspaceRoot={null}
      hoverPreviewEnabled={false} pdfDocument={null} reflowTranslationMode="source"
      segmentGroup={buildReflowSegmentGroups([list])[0]} annotationsBySegmentUid={new Map()}
      notesBySegmentUid={new Map()} translationBySegmentUid={new Map()} sourceLinkCountBySegmentUid={new Map()} sourceBacklinksBySegmentUid={{}}
      onActivateSegment={activate} onOpenSegmentAnnotation={vi.fn()} onOpenSegmentNote={note}
      onPreviewChange={vi.fn()} onRequirePdfDocument={vi.fn()} onHideSegment={vi.fn()}
      onCopyContent={copy} onCopySourceLink={vi.fn()} onOpenSourceBacklink={vi.fn()} onAddAssistantContext={attach} />
  </ToastContext.Provider></TooltipProvider>);
  return { ...view, activate, attach, copy, note, items: [...view.container.querySelectorAll<HTMLElement>('[data-reflow-list-item]')] };
}
afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); pdfBlockDrag.cancel(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('reflow list item actions', () => {
  it('uses the same source item for pointer selection, keyboard selection and context actions', () => {
    const { items, activate, attach, note } = setup();
    fireEvent.click(items[1]);
    expect(activate).toHaveBeenLastCalledWith(expect.objectContaining({ uid: 'list:list-item:1', text: 'Beta' }), { jumpToPdf: true });
    fireEvent.keyDown(items[0], { key: 'Enter' });
    expect(activate).toHaveBeenLastCalledWith(expect.objectContaining({ uid: 'list:list-item:0', text: 'Alpha' }), { jumpToPdf: true });
    fireEvent.keyDown(items[1], { key: 'F10', shiftKey: true });
    fireEvent.click(screen.getByRole('menuitem', { name: '附到助手对话' }));
    expect(attach).toHaveBeenCalledWith(expect.objectContaining({ uid: 'list:list-item:1', text: 'Beta' }));
    fireEvent.contextMenu(items[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: '为此处写笔记' }));
    expect(note).toHaveBeenCalledWith(expect.objectContaining({ uid: 'list:list-item:1' }));
    fireEvent.contextMenu(items[1]);
    fireEvent.click(screen.getByRole('menuitem', { name: '添加整个列表到助手' }));
    expect(attach).toHaveBeenLastCalledWith(list);
  });
  it('keeps copying and native text selection independent from selecting a list item', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { items, activate } = setup();
    fireEvent.click(within(items[1]).getByRole('button', { name: '复制这一项' }));
    expect(writeText).toHaveBeenCalledWith('Beta');
    expect(activate).not.toHaveBeenCalled();
    const range = document.createRange(); range.selectNodeContents(within(items[1]).getByText('Beta'));
    window.getSelection()?.addRange(range);
    fireEvent.click(items[1]);
    fireEvent.contextMenu(items[1]);
    expect(activate).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
  });
  it('captures a Ctrl drag from a list item and cancels without selecting the parent', () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 7; isPrimary = true; });
    const { container, items, activate } = setup();
    const section = container.querySelector('section')!;
    Object.assign(section, { setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() });
    fireEvent.pointerDown(items[1], { button: 0, buttons: 1, ctrlKey: true, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(section, { buttons: 1, clientX: 200, clientY: 100 });
    expect(pdfBlockDrag.getState()?.segment).toMatchObject({ uid: 'list:list-item:1', text: 'Beta' });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(items[1]);
    expect(pdfBlockDrag.getState()).toBeNull();
    expect(activate).not.toHaveBeenCalled();
  });
});
