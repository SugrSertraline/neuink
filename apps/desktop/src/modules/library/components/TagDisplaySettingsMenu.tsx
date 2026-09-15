import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { useTagPreferences } from '@/shared/components/TagPreferencesProvider';
import { TAG_NAVIGATION_LABELS, type TagDensity, type TagNavigationMode } from '@/shared/lib/tagPreferences';

export function TagDisplaySettingsMenu({ navigation = false, compact = false, onCollapseAll, canCollapseAll = false }: {
  navigation?: boolean;
  compact?: boolean;
  onCollapseAll?: () => void;
  canCollapseAll?: boolean;
}) {
  const { preferences, persistenceError, updatePreferences } = useTagPreferences();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={navigation ? '标签导航与显示设置' : '论文标签显示设置'} className={navigation ? 'px-1 text-[11px] font-normal text-muted-foreground' : undefined} size={navigation ? compact ? 'icon-sm' : 'xs' : 'icon-xs'} title={navigation ? `标签显示设置 · ${TAG_NAVIGATION_LABELS[preferences.navigationMode]}` : '标签显示设置'} type="button" variant="ghost">
          {navigation && !compact ? <>{TAG_NAVIGATION_LABELS[preferences.navigationMode]}<ChevronDown size={12} aria-hidden="true" /></> : <SlidersHorizontal className="size-3" aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64" viewportAligned>
        {navigation ? <>
          {onCollapseAll && preferences.navigationMode === 'tree' ? <>
            <DropdownMenuItem disabled={!canCollapseAll} onSelect={onCollapseAll}>收起全部</DropdownMenuItem>
            <DropdownMenuSeparator />
          </> : null}
          <DropdownMenuLabel>浏览方式</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={preferences.navigationMode} onValueChange={value => updatePreferences({ navigationMode: value as TagNavigationMode })}>
            {Object.entries(TAG_NAVIGATION_LABELS).map(([value, label]) => <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>侧栏密度</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={preferences.density} onValueChange={value => updatePreferences({ density: value as TagDensity })}>
            <DropdownMenuRadioItem value="compact">紧凑</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="comfortable">舒适</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem checked={preferences.showCounts} onCheckedChange={checked => updatePreferences({ showCounts: checked })}>显示子标签和论文数量</DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
        </> : null}
        <DropdownMenuLabel>论文标签 · 列表、侧栏与概览</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={preferences.onlyMostSpecificTags} onCheckedChange={checked => updatePreferences({ onlyMostSpecificTags: checked })}>只显示最具体的标签</DropdownMenuCheckboxItem>
        <p className="px-2 py-1 text-xs leading-5 text-muted-foreground">同一论文已关联子标签时，隐藏重复的上级标签。不同分支仍保留，不修改实际归属。</p>
        {persistenceError ? <p className="px-2 py-1 text-xs text-destructive" role="alert">{persistenceError}</p> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
