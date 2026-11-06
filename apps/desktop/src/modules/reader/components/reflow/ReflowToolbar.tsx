import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { EntryContentHeader } from '../EntryContentHeader';
import { useReflowToolbarLayout } from './useReflowToolbarLayout';

export function ReflowToolbar({ compact, entryTitle, appearance, translationMode, busy, children, navigation, primaryTools }: {
  navigation?: ReactNode;
  primaryTools?: ReactNode;
  compact: boolean; entryTitle: string; appearance: ReactNode; translationMode: ReactNode; busy: boolean; children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const items = Children.toArray(children);
  const keys = items.map((item, index) => isValidElement(item) ? String(item.key ?? index) : String(index));
  const layout = useReflowToolbarLayout(compact, menuOpen, JSON.stringify(keys));
  const collapsed = compact || layout.primaryCollapsed;
  const visibleCount = compact ? 0 : Math.min(items.length, layout.visibleCount);
  const hasOverflow = collapsed || visibleCount < items.length;
  useEffect(() => { if (!hasOverflow) setMenuOpen(false); }, [hasOverflow]);
  const hiddenClass = 'absolute -left-[10000px] top-0 invisible pointer-events-none';
  const tools = <Popover open={menuOpen && hasOverflow} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild><Button ref={layout.menuRef} aria-hidden={!hasOverflow || undefined}
        className={`reflow-toolbar-menu shrink-0 ${hasOverflow ? '' : hiddenClass}`} size="sm" variant={busy ? 'secondary' : 'outline'} aria-label="重排阅读工具菜单" title="内容显示、悬停预览、翻译与导出"><MoreHorizontal aria-hidden="true" /><span className="reflow-toolbar-menu-label">{busy ? '翻译中' : '阅读工具'}</span></Button></PopoverTrigger>
      <PopoverContent viewportAligned align="end" className="w-72 max-w-[calc(100vw-2rem)] space-y-3"
        onCloseAutoFocus={event => {
          if (layout.menuRef.current?.getAttribute('aria-hidden') !== 'true') return;
          event.preventDefault();
          const controls = layout.rowRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"]');
          [...controls ?? []].find(control => !control.closest('[aria-hidden="true"]'))?.focus({ preventScroll: true });
        }}>
        <p className="text-xs font-medium">内容显示、翻译与导出</p>
        <div className="flex flex-wrap items-center gap-2">{menuOpen ? <>{collapsed ? primaryTools : null}{items.slice(visibleCount)}</> : null}</div>
      </PopoverContent>
    </Popover>;
  return <div className="reflow-toolbar min-w-0" data-collapsed={collapsed}>
    {compact ? <div aria-label="重排阅读工具" data-reader-compact-toolbar className="flex min-h-9 min-w-0 shrink-0 items-center gap-1 border-b bg-background px-2 py-0.5">
      {navigation}{appearance}<div className="min-w-0 flex-1" />{translationMode}{tools}
    </div> : <>
      <EntryContentHeader className="gap-2 border-b-0" contentTitle="重排视图" entryTitle={entryTitle} entryTitleTooltip>
        {navigation}{appearance}
      </EntryContentHeader>
      <div ref={layout.rowRef} aria-label="重排阅读工具" data-material="reader-toolbar-row" className="reflow-toolbar-controls relative flex min-w-0 flex-wrap items-center justify-between gap-1.5 border-b bg-background px-4 pb-2">
        <div data-reflow-tools-left className={`flex min-w-0 items-center gap-1.5 ${collapsed ? 'absolute' : ''}`}>
          <div ref={layout.primaryRef} data-reflow-primary-tools aria-hidden={collapsed || undefined}
            className={`w-max shrink-0 empty:hidden ${collapsed ? hiddenClass : ''}`}>{menuOpen && collapsed ? null : primaryTools}</div>
          {items.map((item, index) => <div key={keys[index]} data-reflow-toolbar-item={index} aria-hidden={index >= visibleCount || undefined}
            className={`w-max shrink-0 empty:hidden ${index >= visibleCount ? hiddenClass : ''}`}>{menuOpen && index >= visibleCount ? null : item}</div>)}
        </div>
        <div data-reflow-tools-right className={`ml-auto flex min-w-0 items-center gap-1.5 ${collapsed ? 'flex-1 flex-wrap justify-between' : 'shrink-0'}`}>
          <div ref={layout.languageRef} data-reflow-language-tools className="w-max max-w-full min-w-0 empty:hidden">{translationMode}</div>{tools}
        </div>
      </div>
    </>}
  </div>;
}
