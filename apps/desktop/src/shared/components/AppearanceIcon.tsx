import type { ReactNode } from 'react';
import { useAppearance } from './AppearanceProvider';
import { appearanceIcons } from '../assets/appearance';

/** Object icons only replace navigation landmarks; small action glyphs stay legible. */
export function AppearanceIcon({ kind, children }: { kind: keyof typeof appearanceIcons; children: ReactNode }) {
  const { appearance } = useAppearance();
  return appearance === 'atelier'
    ? <img className="appearance-object-icon" src={appearanceIcons[kind]} alt="" draggable={false} />
    : <>{children}</>;
}
