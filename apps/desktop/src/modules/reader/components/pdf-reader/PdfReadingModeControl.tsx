import { BookOpen, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';
import { effectivePdfBookMode } from './pdfReadingMode';

export function PdfReadingModeControl({ preferences, onChange }: { preferences: ReaderPreferences; onChange: (next: ReaderPreferences) => void }) {
  const { appearance } = useAppearance();
  const available = appearance === 'atelier';
  const book = effectivePdfBookMode(appearance, preferences);
  return <Button size="sm" variant={book ? 'secondary' : 'outline'} aria-pressed={book}
    aria-label={available ? '书页阅读' : '连续阅读；书页模式仅拟物主题可用'}
    title={available ? (book ? '切换为连续滚动' : '切换为书页阅读；保留选字、批注和引用') : '书页模式仅拟物主题可用'}
    disabled={!available}
    onClick={() => { if (available) onChange({ ...preferences, pageTurningMode: book ? 'scroll' : 'book' }); }}>
    {book ? <BookOpen size={14} aria-hidden="true" /> : <ScrollText size={14} aria-hidden="true" />}
    <span>{book ? '书页' : '连续'}</span>
  </Button>;
}
