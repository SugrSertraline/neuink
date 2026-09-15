import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useToast } from "@/shared/hooks/useToast";
import type { SegmentBlockNote, SourceSegment } from "@/shared/types/domain";
import { logicalSegmentUid } from "./readerUtils";
import { segmentNoteErrorMessage } from "./segmentNoteError";
import {
  getSegmentNoteValidation,
  getSegmentNoteVisibleText,
} from "./segmentNoteLimits";
import {
  registerSegmentEditorCloseHandler,
  setSegmentEditorDirty,
} from "../segmentEditorDirtyRegistry";

export function useSegmentNoteDraft({
  entryId,
  draftScopeKey,
  notesBySegmentUid,
  onSegmentNotesSaved,
  onSaveSegmentNote,
  onSharedDraftChange,
  sharedDrafts,
}: {
  entryId: string;
  draftScopeKey?: string;
  notesBySegmentUid: Map<string, SegmentBlockNote>;
  onSegmentNotesSaved?: (notes: SegmentBlockNote[]) => void;
  onSaveSegmentNote: (
    entryId: string,
    segmentUid: string,
    text: string,
  ) => Promise<SegmentBlockNote[]>;
  onSharedDraftChange?: (segmentUid: string, text: string | null) => void;
  sharedDrafts?: Record<string, string>;
}) {
  const { notify } = useToast();
  const ownerId = `segment-note:${useId()}`;
  const [selectedSegment, setSelectedSegment] = useState<SourceSegment | null>(
    null,
  );
  const [noteText, setNoteText] = useState("");
  const [savedNoteText, setSavedNoteText] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const lastSharedDraftRef = useRef<{ segmentUid: string; text: string | undefined } | null>(null);

  const noteDirty = selectedSegment !== null && noteText !== savedNoteText;
  const savingRef = useRef(false);
  const liveDraft = useRef({ entryId, segmentUid: selectedSegment ? logicalSegmentUid(selectedSegment) : null, text: noteText, baseline: savedNoteText });
  liveDraft.current = { entryId, segmentUid: selectedSegment ? logicalSegmentUid(selectedSegment) : null, text: noteText, baseline: savedNoteText };
  const isDirty = () => savingRef.current || (liveDraft.current.segmentUid !== null && liveDraft.current.text !== liveDraft.current.baseline);

  const resetDraft = () => {
    setSelectedSegment(null);
    setNoteText("");
    setSavedNoteText("");
  };

  const discardNote = useCallback(() => {
    if (selectedSegment) {
      onSharedDraftChange?.(logicalSegmentUid(selectedSegment), null);
    }
    setNoteText(savedNoteText);
  }, [onSharedDraftChange, savedNoteText, selectedSegment]);

  const saveNote = useCallback(
    async () => {
      if (!selectedSegment || !noteDirty || savingRef.current) {
        return null;
      }

      if (
        getSegmentNoteValidation(getSegmentNoteVisibleText(noteText)).overLimit
      ) {
        return null;
      }

      savingRef.current = true;
      setNoteBusy(true);

      try {
        const segmentUid = logicalSegmentUid(selectedSegment);
        const nextNotes = await onSaveSegmentNote(
          entryId,
          segmentUid,
          noteText,
        );
        if (liveDraft.current.entryId !== entryId || liveDraft.current.segmentUid !== segmentUid) return null;
        const unchanged = liveDraft.current.text === noteText;
        liveDraft.current.baseline = noteText;
        onSegmentNotesSaved?.(nextNotes);
        setSavedNoteText(noteText);
        // Only clear the saved snapshot, never text entered while the request was pending.
        if (unchanged) onSharedDraftChange?.(segmentUid, null);
        notify({
          tone: "success",
          title: "已保存",
          description: "片段笔记已更新",
        });
        return unchanged ? nextNotes : null;
      } catch (caught) {
        notify({
          tone: "danger",
          title: "保存失败",
          description: segmentNoteErrorMessage(caught),
        });
        return null;
      } finally {
        savingRef.current = false;
        setNoteBusy(false);
      }
    },
    [
      entryId,
      noteBusy,
      noteDirty,
      noteText,
      notify,
      onSegmentNotesSaved,
      onSaveSegmentNote,
      onSharedDraftChange,
      selectedSegment,
    ],
  );

  const selectSegment = (segment: SourceSegment) => {
    if (
      selectedSegment &&
      logicalSegmentUid(selectedSegment) === logicalSegmentUid(segment)
    ) {
      return true;
    }
    if (
      selectedSegment &&
      (noteDirty || noteBusy) &&
      logicalSegmentUid(selectedSegment) !== logicalSegmentUid(segment)
    ) {
      notify({
        tone: "default",
        title: "当前片段笔记尚未保存",
        description: "请先保存或放弃当前修改，再切换到其他片段。",
      });
      return false;
    }

    const segmentUid = logicalSegmentUid(segment);
    const savedText = notesBySegmentUid.get(segmentUid)?.text ?? "";
    const nextDraft = sharedDrafts?.[segmentUid] ?? savedText;
    lastSharedDraftRef.current = { segmentUid, text: sharedDrafts?.[segmentUid] };

    setSelectedSegment(segment);
    setNoteText(nextDraft);
    setSavedNoteText(savedText);
    return true;
  };

  const updateNoteText = (value: string) => {
    liveDraft.current.text = value;
    setNoteText(value);
    if (selectedSegment) {
      onSharedDraftChange?.(logicalSegmentUid(selectedSegment), value);
    }
  };

  useEffect(() => {
    resetDraft();
  }, [entryId]);

  useEffect(() => {
    if (!selectedSegment || noteBusy) {
      return;
    }

    const segmentUid = logicalSegmentUid(selectedSegment);
    const savedText = notesBySegmentUid.get(segmentUid)?.text ?? "";
    if (savedText === noteText) {
      setSavedNoteText(savedText);
      return;
    }
    if (!noteDirty) {
      setNoteText(sharedDrafts?.[segmentUid] ?? savedText);
      setSavedNoteText(savedText);
    }
  }, [noteBusy, noteDirty, noteText, notesBySegmentUid, selectedSegment, sharedDrafts]);

  useEffect(() => {
    if (!selectedSegment) {
      return;
    }
    const sharedDraft = sharedDrafts?.[logicalSegmentUid(selectedSegment)];
    const segmentUid = logicalSegmentUid(selectedSegment);
    if (
      lastSharedDraftRef.current?.segmentUid === segmentUid &&
      lastSharedDraftRef.current.text === sharedDraft
    ) {
      return;
    }
    lastSharedDraftRef.current = { segmentUid, text: sharedDraft };
    if (sharedDraft !== undefined && sharedDraft !== noteText) {
      setNoteText(sharedDraft);
    }
  }, [noteBusy, noteText, selectedSegment, sharedDrafts]);

  useEffect(() => {
    if (!draftScopeKey) return;
    setSegmentEditorDirty(draftScopeKey, ownerId, noteDirty || noteBusy);
    return () => setSegmentEditorDirty(draftScopeKey, ownerId, false);
  }, [draftScopeKey, noteDirty, noteBusy, ownerId]);

  useEffect(() => {
    if (!draftScopeKey) return;
    return registerSegmentEditorCloseHandler(draftScopeKey, ownerId, {
      discard: discardNote,
      save: async () => {
        if (!isDirty()) return true;
        return Boolean(await saveNote());
      },
      isDirty,
    });
  }, [discardNote, draftScopeKey, noteDirty, ownerId, saveNote]);

  return {
    noteBusy,
    noteDirty,
    noteText,
    discardNote,
    resetDraft,
    saveNote,
    selectedSegment,
    selectSegment,
    updateNoteText,
  };
}
