import type { ComponentProps } from 'react';
import { useAppearance } from '@/shared/components/AppearanceProvider';
import { LibraryPaperTable } from './LibraryPaperTable';
import { LibraryPaperShelf } from './LibraryPaperShelf';

export function LibraryPapers(props: ComponentProps<typeof LibraryPaperTable>) {
  const { appearance, libraryDisplay } = useAppearance();
  const shelf = appearance === 'atelier' && libraryDisplay === 'shelf';
  return <>
    {/* Keep the original table and its scroll/column state mounted across appearance changes. */}
    <div className={shelf ? 'hidden' : 'flex min-h-0 min-w-0 flex-1 flex-col'} aria-hidden={shelf || undefined}>
      <LibraryPaperTable {...props} active={props.active && !shelf} />
    </div>
    {appearance === 'atelier' ? <div className={shelf ? 'flex min-h-0 min-w-0 flex-1 flex-col' : 'hidden'} aria-hidden={!shelf || undefined}>
      <LibraryPaperShelf {...props} active={props.active && shelf} />
    </div> : null}
  </>;
}
