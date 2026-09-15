import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { Badge } from '@/components/ui/badge';
import { useState } from 'react';
import { useTagPreferences } from '@/shared/components/TagPreferencesProvider';
import { getEntryTagLabel, getVisibleEntryTags } from '@/shared/lib/tagPreferences';
import { TagDisplaySettingsMenu } from './TagDisplaySettingsMenu';

const DESCRIPTION_PREVIEW_LENGTH = 240;
const VISIBLE_TAG_LIMIT = 10;
const VISIBLE_FIELD_LIMIT = 2;

export function CompactEntryDescription({ description }: { description: string }) {
  const normalized = description.trim();
  const truncated = normalized.length > DESCRIPTION_PREVIEW_LENGTH;
  const preview = truncated ? `${normalized.slice(0, DESCRIPTION_PREVIEW_LENGTH).trimEnd()}...` : normalized;

  return (
    <div className="grid h-[5.75rem] min-w-0 grid-rows-[minmax(0,1fr)_auto] text-xs leading-5">
      <p className="line-clamp-3 whitespace-pre-wrap break-words">{preview}</p>
      {truncated ? (
        <HoverCard>
          <HoverCardTrigger asChild openOnClick>
            <button className="text-left text-[11px] text-primary hover:underline" type="button">
              还有 {normalized.length - DESCRIPTION_PREVIEW_LENGTH} 字未显示
            </button>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-[34rem] whitespace-pre-wrap text-xs">
            {normalized}
          </HoverCardContent>
        </HoverCard>
      ) : null}
    </div>
  );
}

export function CompactEntryTags({ tags }: { tags: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const { preferences } = useTagPreferences();
  const displayTags = getVisibleEntryTags(tags, preferences.onlyMostSpecificTags);
  const hiddenAncestors = new Set(tags).size - displayTags.length;
  const visible = expanded ? displayTags : displayTags.slice(0, VISIBLE_TAG_LIMIT);
  const hiddenCount = Math.max(0, displayTags.length - VISIBLE_TAG_LIMIT);

  return (
    <div className="grid min-h-12 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="flex min-w-0 flex-wrap content-start items-center gap-1 overflow-hidden">
        {visible.map((tag) => (
          <Badge className="min-w-0 max-w-full shrink justify-start" key={tag} title={tag} variant="secondary">
            <span className="min-w-0 truncate">{getEntryTagLabel(tag, displayTags)}</span>
          </Badge>
        ))}
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1 pt-1">
        {hiddenAncestors > 0 ? <span className="mr-auto text-[11px] text-muted-foreground">已隐藏 {hiddenAncestors} 个上级标签</span> : null}
        <TagDisplaySettingsMenu />
        {hiddenCount > 0 ? (
        <button
          aria-label={expanded ? '收起标签' : `展开全部 ${displayTags.length} 个标签`}
          className="justify-self-end rounded px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? '收起' : '…'}
        </button>
        ) : null}
      </div>
    </div>
  );
}

export function CompactEntryFields({ fields }: { fields: Array<[string, string]> }) {
  const visible = fields.slice(0, VISIBLE_FIELD_LIMIT);
  const hidden = fields.slice(VISIBLE_FIELD_LIMIT);

  return (
    <div className="grid h-[4.5rem] min-w-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid content-start gap-1 overflow-hidden">
        {visible.map(([key, value]) => (
          <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)] gap-2 text-xs" key={key}>
            <span className="truncate font-medium text-foreground" title={key}>{key}</span>
            <span className="truncate text-muted-foreground" title={value}>{value}</span>
          </div>
        ))}
      </div>
      {hidden.length > 0 ? (
        <HoverCard>
          <HoverCardTrigger asChild openOnClick>
            <button className="w-fit text-left text-[11px] text-primary hover:underline" type="button">
              还有 {hidden.length} 项未显示
            </button>
          </HoverCardTrigger>
          <HoverCardContent align="start" className="w-[34rem]">
            <dl className="grid gap-3 text-xs">
              {fields.map(([key, value]) => (
                <div className="min-w-0" key={key}>
                  <dt className="font-medium text-foreground">{key}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          </HoverCardContent>
        </HoverCard>
      ) : <span />}
    </div>
  );
}
