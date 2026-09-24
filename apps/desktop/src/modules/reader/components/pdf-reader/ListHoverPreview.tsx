import type { ListItemRegion } from './listItemRegions';

type ListItem = {
  marker: string | null;
  text: string;
};

export function ListHoverPreview({
  regions,
  text,
  onItemHover,
}: {
  regions: ListItemRegion[];
  text: string;
  onItemHover: (bbox: ListItemRegion['bbox'] | null) => void;
}) {
  const parsedItems = parseListItems(text);
  const items = parsedItems.length > 0
    ? parsedItems
    : regions.map((region) => ({
        marker: null,
        text: region.text,
      }));

  if (items.length === 0) {
    return <p className="whitespace-pre-wrap break-words text-[inherit] leading-[inherit]">{text}</p>;
  }

  return (
    <div className="min-w-0">
      <ol className="grid gap-2">
        {items.map((item, index) => {
          return (
            <li
              className="rounded-md border bg-background/70 px-2 py-1.5 text-[inherit] leading-[inherit] transition-colors hover:border-primary/40 hover:bg-primary/5"
              key={`${item.marker ?? 'item'}-${index}`}
              onPointerEnter={() => onItemHover(findListItemRegion(item, regions)?.bbox ?? null)}
              onPointerLeave={() => onItemHover(null)}
            >
              <div>
                <span className="mr-1 font-medium text-foreground">{item.marker ?? `•`}</span>
                <span className="whitespace-pre-wrap break-words">{item.text}</span>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function findListItemRegion(item: ListItem, regions: ListItemRegion[]) {
  const normalized = (value: string) => value.replace(/\s+/g, ' ').trim();
  const number = (marker: string | null) => marker?.match(/^(?:\[(\d+)\]|(\d+)[.)])$/)?.slice(1).find(Boolean);
  const marker = number(item.marker);
  const matches = regions.filter(region => {
    const parsed = parseListItems(region.text);
    if (parsed.length > 1) return false;
    const candidate = parsed[0];
    if (marker && candidate && number(candidate.marker)) return marker === number(candidate.marker);
    return normalized(candidate?.text ?? region.text) === normalized(item.text);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function parseListItems(text: string): ListItem[] {
  const items: ListItem[] = [];

  // MinerU/Markdown may wrap bibliography markers in bullets or emphasis.
  const normalized = text.replace(/(^|\n)(\s*)(?:[-*+]\s+)?(?:\*\*|__)?(?:\\?\[\s*(\d+)\s*\\?\]|［\s*(\d+)\s*］)(?:\*\*|__)?(?=\s)/g, '$1$2[$3$4]');
  for (const line of normalized.split(/\r?\n/)) {
    const match = line.match(/^\s*((?:[-*+])|(?:\d+[.)])|(?:\[[^\]]+\]))\s+(.*)$/);
    if (match) {
      items.push({ marker: match[1], text: match[2] });
      continue;
    }

    const continuation = line.trim();
    if (continuation && items.length > 0) {
      items[items.length - 1].text += `\n${continuation}`;
    }
  }

  return items;
}
