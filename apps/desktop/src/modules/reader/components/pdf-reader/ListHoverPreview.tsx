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
    return <p className="whitespace-pre-wrap break-words text-sm leading-6">{text}</p>;
  }

  return (
    <div className="max-h-[min(55vh,30rem)] min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
      <ol className="grid gap-2">
        {items.map((item, index) => {
          const isLong = item.text.length > 420;
          return (
            <li
              className="rounded-md border bg-background/70 px-2 py-1.5 text-sm leading-6 transition-colors hover:border-primary/40 hover:bg-primary/5"
              key={`${item.marker ?? 'item'}-${index}`}
              onPointerEnter={() => onItemHover(regions[index]?.bbox ?? null)}
              onPointerLeave={() => onItemHover(null)}
            >
              <div className={isLong ? 'max-h-40 overflow-y-auto overscroll-contain pr-1' : undefined}>
                <span className="mr-1 font-medium text-foreground">{item.marker ?? `•`}</span>
                <span className="whitespace-pre-wrap break-words">{item.text}</span>
              </div>
              {isLong ? <div className="mt-1 text-[11px] text-muted-foreground">此长列表项可单独滚动查看</div> : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function listItemTextAtIndex(text: string, index: number) {
  const parsedItem = parseListItems(text)[index];
  if (parsedItem) {
    return `${parsedItem.marker ?? '•'} ${parsedItem.text}`;
  }

  const nonEmptyLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (nonEmptyLines.length > 1 || index === 0) {
    return nonEmptyLines[index] ?? null;
  }
  return null;
}

export function parseListItems(text: string): ListItem[] {
  const items: ListItem[] = [];

  for (const line of text.split(/\r?\n/)) {
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
