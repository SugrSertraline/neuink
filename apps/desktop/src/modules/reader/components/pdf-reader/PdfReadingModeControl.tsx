import { BookOpen, ScrollText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ReaderPreferences } from '@/shared/lib/readerPreferences';

export function PdfReadingModeControl({ preferences, onChange }: { preferences: ReaderPreferences; onChange: (next: ReaderPreferences) => void }) {
  const book = preferences.pageTurningMode === 'book';
  return <Button size="sm" variant={book ? 'secondary' : 'outline'} aria-pressed={book}
    aria-label="书页阅读" title={book ? '切换为连续滚动' : '切换为书页阅读；保留选字、批注和引用'}
    onClick={() => onChange({ ...preferences, pageTurningMode: book ? 'scroll' : 'book' })}>
    {book ? <BookOpen size={14} aria-hidden="true" /> : <ScrollText size={14} aria-hidden="true" />}
    <span>{book ? '书页' : '连续'}</span>
  </Button>;
}
