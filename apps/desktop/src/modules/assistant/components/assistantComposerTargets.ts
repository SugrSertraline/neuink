import type { LibraryEntry } from '@/modules/library/components/LibrarySidebar';
import type { TagMeta } from '@/shared/types/domain';
import { entryContentTargets, type EntryContextTarget } from './assistantContextTargets';
import { kindLabel, type MentionAttrs } from './AssistantMentionChip';
import type { ComposerPickerItem } from './AssistantComposerTargetPicker';

export type ComposerTarget = (EntryContextTarget & { kind: 'entry' }) | { kind: 'tag'; tag: TagMeta };

export function buildComposerTargets(entries: LibraryEntry[], tags: TagMeta[]): ComposerTarget[] {
  return [...tags.map((tag): ComposerTarget => ({ kind: 'tag', tag })),
    ...entries.flatMap(entry => entryContentTargets(entry).map((target): ComposerTarget => ({ ...target, kind: 'entry' })))];
}


export function filterMentionTargets(targets: ComposerTarget[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return targets.filter(target => target.kind === 'entry' &&
    (target.contentKind === 'pdf' || target.contentKind === 'note'))
    .filter(target => !normalized || targetSearchText(target).toLocaleLowerCase().includes(normalized));
}

export function targetToMention(target: ComposerTarget): MentionAttrs {
  if (target.kind === 'tag') return {
    entryId: '', entryTitle: '', id: `tag:${target.tag.id}`, kind: 'tag', label: target.tag.name,
    role: null, tagId: target.tag.id, tagName: target.tag.name
  };
  const contentKind = target.contentKind ?? 'entry';
  return {
    contentId: contentKind === 'entry' ? null : target.contentId ?? contentKind,
    contentTitle: contentKind === 'entry' ? null : target.contentTitle ?? kindLabel(contentKind),
    entryId: target.entry.id, entryTitle: target.entry.title, id: targetContextItemId(target), kind: contentKind,
    label: targetLabel(target), role: null
  };
}

export function targetContextItemId(target: ComposerTarget) {
  if (target.kind === 'tag') return `tag:${target.tag.id}`;
  const kind = target.contentKind ?? 'entry';
  return kind === 'entry' ? `entry:${target.entry.id}` : `entry:${target.entry.id}:${kind}:${target.contentId ?? kind}`;
}

export function targetSearchText(target: ComposerTarget) {
  if (target.kind === 'tag') return `${target.tag.name} tag`;
  return [targetLabel(target), target.entry.title, target.entry.tags.join(' ')].join(' ');
}

export function targetLabel(target: ComposerTarget) {
  if (target.kind === 'tag') return target.tag.name;
  if (target.contentKind === 'pdf') return target.entry.pdfFileName ?? target.entry.title;
  if (target.contentKind === 'note') return target.contentTitle ?? target.entry.title;
  return target.entry.title;
}

export function targetDescription(target: ComposerTarget) {
  return target.kind === 'tag' ? '标签范围' : target.entry.title;
}

export function targetPickerItem(target: ComposerTarget): ComposerPickerItem<ComposerTarget> {
  return {
    id: targetContextItemId(target), kind: target.kind === 'tag' ? target.kind
      : target.contentKind === 'pdf' ? 'pdf' : target.contentKind === 'note' ? 'note' : 'entry',
    label: targetLabel(target), description: targetDescription(target), searchText: targetSearchText(target), value: target
  };
}
