import type { ReactNode } from 'react';
import { useAppearance } from './AppearanceProvider';
import { appearanceIcons } from '../assets/appearance';

type IconKind = keyof typeof appearanceIcons | 'calendar' | 'settings' | 'import' | 'create';

/** Retain recognizable action glyphs on the theme's metal control face. */
export function AppearanceIcon({ kind, children }: { kind: IconKind; children: ReactNode }) {
  const { appearance } = useAppearance();
  if (appearance !== 'atelier') return <>{children}</>;
  return kind in appearanceIcons
    ? <img className="appearance-object-icon" src={appearanceIcons[kind as keyof typeof appearanceIcons]} alt="" draggable={false} />
    : <span className="appearance-tool-icon" data-icon-kind={kind} aria-hidden="true">{children}</span>;
}
