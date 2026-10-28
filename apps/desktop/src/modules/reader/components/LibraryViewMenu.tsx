import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { getLibraryViewTitle, type LibraryView } from '@/modules/library/utils/libraryView';

const parseViews: LibraryView[] = ['pdf', 'unparsed', 'parsed', 'parsing', 'failed', 'no_pdf'];

export function LibraryViewMenu({ view, onSelect }: { view: LibraryView; onSelect: (view: LibraryView) => void }) {
  const title = getLibraryViewTitle(view);
  const item = (value: LibraryView) => <DropdownMenuRadioItem key={value} value={value}>{getLibraryViewTitle(value)}</DropdownMenuRadioItem>;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button size="xs" variant={view === 'all' ? 'ghost' : 'secondary'} className="shrink-0 px-2 font-semibold" aria-label={`条目范围：${title}`} title="切换条目范围，保留当前标签与搜索">
        {title}<ChevronDown size={12} aria-hidden="true" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" viewportAligned>
      <DropdownMenuRadioGroup value={view} onValueChange={value => onSelect(value as LibraryView)}>
        {item('all')}{item('recent')}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>解析状态</DropdownMenuLabel>
        {parseViews.map(item)}
        <DropdownMenuSeparator />
        {item('trash')}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
