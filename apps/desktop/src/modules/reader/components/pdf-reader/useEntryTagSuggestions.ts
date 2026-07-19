import { useEffect, useMemo, useState } from "react";

import { analyzeEntryTags, type TagRecommendation } from "@/shared/ipc/assistantApi";
import { useToast } from "@/shared/hooks/useToast";
import type { SourceSegment } from "@/shared/types/domain";

import type { LibraryEntry } from "../../../library/components/LibrarySidebar";

const TAG_SUGGESTION_DISMISSED_STORAGE_KEY =
  "neuink.reader.dismissedTagSuggestion";
const ACCEPTED_TAG_SUGGESTION_ENTRIES_STORAGE_KEY =
  "neuink.reader.acceptedTagSuggestionEntries";

type UseEntryTagSuggestionsOptions = {
  entry: LibraryEntry;
  onApplyEntryTagPaths: (
    entryId: string,
    tagPaths: string[],
  ) => Promise<unknown> | unknown;
  segments: SourceSegment[];
  workspaceRoot: string | null;
};

export function useEntryTagSuggestions({
  entry,
  onApplyEntryTagPaths,
  segments,
  workspaceRoot,
}: UseEntryTagSuggestionsOptions) {
  const { notify } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recommendations, setRecommendations] = useState<TagRecommendation[]>([]);
  const [dismissedKey, setDismissedKey] = useState<string | null>(() =>
    readDismissedTagSuggestionKey(),
  );
  const [acceptedEntryKeys, setAcceptedEntryKeys] = useState<Set<string>>(() =>
    readAcceptedTagSuggestionEntries(),
  );
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const suggestionKey = useMemo(
    () => tagSuggestionFingerprint(entry.id, entry.title, segments),
    [entry.id, entry.title, segments],
  );
  const selectedRecommendations = useMemo(
    () => recommendations.filter((tag) => selectedPaths.has(tag.path)),
    [recommendations, selectedPaths],
  );
  const entryKey = `${workspaceRoot ?? ""}:${entry.id}`;
  const accepted = acceptedEntryKeys.has(entryKey);

  useEffect(() => {
    setSelectedPaths(new Set(recommendations.map((tag) => tag.path)));
  }, [recommendations]);

  useEffect(() => {
    setRecommendations([]);
    if (
      entry.status !== "Parsed" ||
      !workspaceRoot ||
      segments.length === 0 ||
      accepted ||
      dismissedKey === suggestionKey
    ) {
      return;
    }

    let cancelled = false;
    setBusy(true);
    void analyzeEntryTags({
      entryId: entry.id,
      instruction: "Suggest useful tags for this paper.",
      root: workspaceRoot,
    })
      .then((response) => {
        if (!cancelled) {
          setRecommendations(response.recommendations);
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          notify({
            tone: "danger",
            title: "标签分析失败",
            description: caught instanceof Error ? caught.message : String(caught),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    accepted,
    dismissedKey,
    entry.id,
    entry.status,
    notify,
    segments.length,
    suggestionKey,
    workspaceRoot,
  ]);

  const toggleRecommendation = (tag: TagRecommendation) => {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(tag.path)) {
        next.delete(tag.path);
      } else {
        next.add(tag.path);
      }
      return next;
    });
  };

  const dismiss = () => {
    writeDismissedTagSuggestionKey(suggestionKey);
    setDismissedKey(suggestionKey);
    setOpen(false);
  };

  const apply = async () => {
    if (busy || selectedRecommendations.length === 0) {
      return;
    }

    setBusy(true);
    try {
      await onApplyEntryTagPaths(
        entry.id,
        selectedRecommendations.map((tag) => tag.path),
      );
      writeDismissedTagSuggestionKey(suggestionKey);
      setDismissedKey(suggestionKey);
      setAcceptedEntryKeys((current) => {
        const next = new Set(current).add(entryKey);
        writeAcceptedTagSuggestionEntries(next);
        return next;
      });
      setOpen(false);
      notify({
        tone: "success",
        title: "推荐标签已保存",
        description: `已添加 ${selectedRecommendations.length} 个标签。`,
      });
    } catch (caught) {
      notify({
        tone: "danger",
        title: "保存推荐标签失败",
        description: caught instanceof Error ? caught.message : String(caught),
      });
    } finally {
      setBusy(false);
    }
  };

  return {
    apply,
    busy,
    dismiss,
    open,
    recommendations: accepted || dismissedKey === suggestionKey ? [] : recommendations,
    selectedPaths,
    setOpen,
    toggleRecommendation,
  };
}

function readDismissedTagSuggestionKey() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(TAG_SUGGESTION_DISMISSED_STORAGE_KEY);
}

function writeDismissedTagSuggestionKey(value: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TAG_SUGGESTION_DISMISSED_STORAGE_KEY, value);
}

function readAcceptedTagSuggestionEntries() {
  if (typeof window === "undefined") {
    return new Set<string>();
  }

  try {
    const value = window.localStorage.getItem(
      ACCEPTED_TAG_SUGGESTION_ENTRIES_STORAGE_KEY,
    );
    const entries = value ? JSON.parse(value) : [];
    return new Set(
      Array.isArray(entries)
        ? entries.filter((entry): entry is string => typeof entry === "string")
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function writeAcceptedTagSuggestionEntries(entries: Set<string>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    ACCEPTED_TAG_SUGGESTION_ENTRIES_STORAGE_KEY,
    JSON.stringify([...entries]),
  );
}

function tagSuggestionFingerprint(
  entryId: string,
  title: string,
  segments: SourceSegment[],
) {
  const content = [
    title,
    ...segments.slice(0, 80).map((segment) =>
      `${segment.uid}:${segment.markdown ?? segment.text}`,
    ),
  ].join("\n");
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${entryId}:${(hash >>> 0).toString(36)}`;
}
