import { Button } from '@/components/ui/button';

export type ImportSource = 'zotero' | 'mineru';

export function ImportSourceSwitch({ source, onChange, disabled = false }: {
  source: ImportSource; onChange: (source: ImportSource) => void; disabled?: boolean;
}) {
  return <div role="group" aria-label="导入来源" className="flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
    <Button type="button" size="sm" variant={source === 'zotero' ? 'secondary' : 'plain'}
      aria-pressed={source === 'zotero'} disabled={disabled} onClick={() => onChange('zotero')}>Zotero</Button>
    <Button type="button" size="sm" variant={source === 'mineru' ? 'secondary' : 'plain'}
      aria-pressed={source === 'mineru'} disabled={disabled} onClick={() => onChange('mineru')}>MinerU</Button>
  </div>;
}
