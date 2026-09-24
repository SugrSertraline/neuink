import { useAppearance } from './AppearanceProvider';
import { useToast } from '../hooks/useToast';

export function AppearanceExit() {
  const { appearance, setAppearance } = useAppearance();
  const { notify } = useToast();
  if (appearance === 'standard') return null;
  const label = appearance === 'atelier' ? '退出拟物' : '退出玻璃';
  return <button type="button" className="appearance-exit" title={`${label}，恢复之前的界面与配色`} onClick={() => {
    const saved = setAppearance('standard');
    if (!saved) notify({ title: '已恢复原有风格', description: '浏览器未允许保存此选择，重新打开后可能需要再次退出。' });
  }}>{label}</button>;
}
