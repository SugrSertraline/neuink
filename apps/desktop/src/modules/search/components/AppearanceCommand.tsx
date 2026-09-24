import { BookOpen, Droplets, Layers2, PanelTop } from 'lucide-react';
import { CommandGroup, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import { useAppearance, type AppAppearance } from '@/shared/components/AppearanceProvider';
import { useToast } from '@/shared/hooks/useToast';

export function isAppearanceCommand(query: string) { return query.trim().toLowerCase() === 'theme'; }

const appearances = [
  { id: 'standard', label: '标准', description: '简洁界面，使用所选强调色', Icon: PanelTop },
  { id: 'atelier', label: '拟物', description: '木质书架、纸张与温润光影', Icon: BookOpen },
  { id: 'liquid-glass', label: '玻璃', description: '半透明按钮、折射边缘与悬浮菜单', Icon: Droplets }
] satisfies { id: AppAppearance; label: string; description: string; Icon: typeof BookOpen }[];

/** The complete theme command opens the quick appearance menu. */
export function AppearanceCommand({ onExecuted }: { onExecuted: () => void }) {
  const { appearance, setAppearance, glassReducedTransparency, setGlassReducedTransparency } = useAppearance();
  const { notify } = useToast();
  return <CommandList className="p-2">
    <CommandGroup heading="选择界面风格">
      {appearances.map(({ id, label, description, Icon }) => <CommandItem key={id} value={`appearance-${id}`}
        data-checked={appearance === id} onSelect={() => {
          const remembered = setAppearance(id);
          notify({ title: `已切换为${label}`,
            description: remembered ? undefined : '当前已切换，但浏览器未允许保存此选择。' });
          onExecuted();
        }} className="gap-3 px-3 py-2.5">
        <Icon aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span>{label}{appearance === id ? <span className="ml-2 text-xs text-muted-foreground">当前</span> : null}</span>
          <span className="text-xs text-muted-foreground">{id === 'liquid-glass' && glassReducedTransparency ? '当前使用实色底，半透明效果已关闭' : description}</span>
        </span>
      </CommandItem>)}
    </CommandGroup>
    {appearance === 'liquid-glass' ? <>
      <CommandSeparator />
      <CommandGroup heading="玻璃显示">
        <CommandItem value="glass-transparency" data-checked={glassReducedTransparency} onSelect={() => {
          const remembered = setGlassReducedTransparency(!glassReducedTransparency);
          if (!remembered) notify({ title: '已调整透明度', description: '当前已生效，但浏览器未允许保存此选择。' });
        }} className="gap-3 px-3 py-2.5">
          <Layers2 aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col gap-1"><span>{glassReducedTransparency ? '恢复通透效果' : '降低透明度'}</span>
            <span className="text-xs text-muted-foreground">{glassReducedTransparency ? '重新开启半透明、背景模糊与折射' : '改用实色底，关闭透明、模糊与折射'}</span></span>
        </CommandItem>
      </CommandGroup>
    </> : null}
  </CommandList>;
}
