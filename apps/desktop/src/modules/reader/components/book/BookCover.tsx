import { useRef } from 'react';
import { useBookStage } from './useBookStage';
import { BookVolume } from './BookVolume';

export function BookCover({ id, title, topic, bookmark = false, enabled = true }: {
  id: string; title: string; topic: string; bookmark?: boolean; enabled?: boolean; mode?: 'shelf' | 'overview';
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Both shelf and overview use live faces; there is no rasterized title texture.
  useBookStage(ref, { title, topic, bookmark }, enabled, 'shelf');
  return <BookVolume ref={ref} id={id} title={title} topic={topic} bookmark={bookmark} />;
}
