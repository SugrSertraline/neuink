import { LibraryBig, List } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import { libraryToolbarGroup, libraryToolbarGroupItem } from './libraryToolbarStyles';

export function LibraryDisplayControl() {
  const { appearance, libraryDisplay, setLibraryDisplay } = useAppearance();
  if (appearance !== 'atelier') return null;
  return <ToggleGroup type="single" spacing={0} size="sm" value={libraryDisplay} aria-label="论文展示方式"
    className={libraryToolbarGroup} onValueChange={value => {
      if (value === 'shelf' || value === 'list') setLibraryDisplay(value);
    }}>
    <ToggleGroupItem className={libraryToolbarGroupItem} value="shelf" aria-label="书架" title="按书封浏览论文"><LibraryBig aria-hidden="true" />书架</ToggleGroupItem>
    <ToggleGroupItem className={libraryToolbarGroupItem} value="list" aria-label="列表" title="按列表浏览论文"><List aria-hidden="true" />列表</ToggleGroupItem>
  </ToggleGroup>;
}
