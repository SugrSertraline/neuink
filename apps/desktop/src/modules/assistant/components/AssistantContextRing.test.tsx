// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantContextRing } from './AssistantContextRing';
import { TooltipProvider } from '@/components/ui/tooltip';

afterEach(cleanup);

const ring = (props: Partial<Parameters<typeof AssistantContextRing>[0]> = {}) => render(
  <TooltipProvider>
    <AssistantContextRing
      compacting={false}
      disabledReason={null}
      kiloTokens={45}
      modelKiloTokens={128}
      onCompact={vi.fn()}
      usageRatio={0.35}
      {...props}
    />
  </TooltipProvider>
);

describe('context ring', () => {
  it('reports usage in its accessible name and compacts on click', () => {
    const onCompact = vi.fn();
    const view = ring({ onCompact });
    const button = view.getByRole('button', { name: /上下文约 45k \/ 128k tokens（35%）/ });
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onCompact).toHaveBeenCalledTimes(1);
  });

  it('warns from 70% and turns to the trigger colour at 90%', () => {
    expect(ring({ usageRatio: 0.7 }).getByRole('button').className).toContain('text-warning');
    cleanup();
    expect(ring({ usageRatio: 0.9 }).getByRole('button').className).toContain('text-destructive');
    cleanup();
    expect(ring({ usageRatio: 0.69 }).getByRole('button').className).toContain('text-muted-foreground');
  });

  it('blocks a second compaction and any compaction during a run', () => {
    const onCompact = vi.fn();
    const running = ring({ disabledReason: '对话正在运行，先停止或等待本轮结束', onCompact });
    // A disabled button may not surface its tooltip, so the reason must be readable without hover.
    const blocked = running.getByRole('button', {
      name: /对话正在运行，先停止或等待本轮结束/
    });
    expect(blocked.hasAttribute('disabled')).toBe(true);
    fireEvent.click(blocked);
    expect(onCompact).not.toHaveBeenCalled();
    cleanup();
    const compacting = ring({ compacting: true, onCompact });
    fireEvent.click(compacting.getByRole('button', { name: '正在压缩全部当前上下文' }));
    expect(onCompact).not.toHaveBeenCalled();
  });
});
