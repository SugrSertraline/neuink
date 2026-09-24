import { useState } from 'react';
import { BookOpen, NotebookPen, Search, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import library from '@/shared/assets/atelier/library-v2.png';
import notes from '@/shared/assets/atelier/notes-v2.png';
import search from '@/shared/assets/atelier/search-v2.png';
import tags from '@/shared/assets/atelier/tags-v2.png';

const icons = {
  library: { image: library, outline: BookOpen, name: '论文收藏', material: '布面 · 纸页' },
  notes: { image: notes, outline: NotebookPen, name: '标签笔记', material: '织物 · 铅笔' },
  search: { image: search, outline: Search, name: '搜索资料', material: '玻璃 · 金属' },
  tags: { image: tags, outline: Tag, name: '研究主题', material: '皮革 · 黄铜' },
} as const;

export type AtelierIconKind = keyof typeof icons;

/** Outline in the standard demo; an alpha-cutout object only in the opt-in skin. */
export function TactileIcon({ kind }: { kind: AtelierIconKind }) {
  const icon = icons[kind];
  const Outline = icon.outline;
  return (
    <span className={`atelier-object-icon object-${kind}`} aria-hidden="true">
      <Outline className="atelier-outline-icon" size={19} strokeWidth={1.6} />
      <img className="atelier-raster-icon" src={icon.image} alt="" draggable={false} decoding="async" />
    </span>
  );
}

/** Local review state only: changing the specimen backdrop never changes the app theme. */
export function IconSpecimens() {
  const [backdrop, setBackdrop] = useState<'light' | 'dark'>('light');
  return (
    <section className="atelier-icon-specimens" aria-label="图标与光影预览">
      <div className="icon-specimen-toolbar">
        <span>同一组物件，同一束光</span>
        <div aria-label="图标预览底色">
          <Button variant="ghost" size="xs" aria-pressed={backdrop === 'light'} onClick={() => setBackdrop('light')}>浅底</Button>
          <Button variant="ghost" size="xs" aria-pressed={backdrop === 'dark'} onClick={() => setBackdrop('dark')}>深底</Button>
        </div>
      </div>
      <div className="icon-specimen-grid" data-backdrop={backdrop}>
        {(Object.keys(icons) as AtelierIconKind[]).map(kind => (
          <figure key={kind}>
            <img src={icons[kind].image} alt={icons[kind].name} draggable={false} />
            <figcaption>{icons[kind].name}<small>{icons[kind].material}</small></figcaption>
          </figure>
        ))}
      </div>
      <p>透明 PNG · 左上方柔光 · 自然轮廓<br />切换底色可查看透明边缘，无图标底板。</p>
    </section>
  );
}
