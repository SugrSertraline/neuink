// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Button } from './button';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('composed tooltip and popover trigger', () => {
  it.each([false, true])('preserves the DOM anchor and returns focus after Escape (reverse=%s)', async reverse => {
    const reference = createRef<HTMLButtonElement>();
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Outer = reverse ? PopoverTrigger : TooltipTrigger;
    const Inner = reverse ? TooltipTrigger : PopoverTrigger;
    render(<TooltipProvider><Popover><Tooltip>
      <Outer asChild><Inner asChild ref={reference}><Button>筛选笔记</Button></Inner></Outer>
      <TooltipContent>调整笔记范围</TooltipContent>
    </Tooltip><PopoverContent><Button>包含子标签</Button></PopoverContent></Popover></TooltipProvider>);
    const trigger = screen.getByRole('button', { name: '筛选笔记' });
    expect(reference.current).toBe(trigger);
    act(() => trigger.focus());
    fireEvent.click(trigger);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '包含子标签' })));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(warning.mock.calls.some(call => String(call[0]).includes('cannot be given refs'))).toBe(false);
  });
});
