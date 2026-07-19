use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    io::Cursor,
    path::PathBuf,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::Utc;
use neuink_domain::{
    Annotation, AnnotationId, AnnotationImportance, AnnotationTextSelection, ContentItem, EntryId,
    EntryMeta, NoteId, PdfAsset, PdfParseState, PdfParseStatus, SegmentBlockNote, SegmentType,
    SegmentUid, SourceSegment, TagId, TagMeta,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use zip::ZipArchive;

use crate::{
    atomic_write, atomic_write_json, AnnotationIndexRecord, WorkspaceError, WorkspaceLayout,
};

#[derive(Clone, Debug)]
pub struct Workspace {
    layout: WorkspaceLayout,
}

impl Workspace {
    pub fn create(root: impl Into<PathBuf>) -> Result<Self, WorkspaceError> {
        let workspace = Self {
            layout: WorkspaceLayout::new(root),
        };
        workspace.ensure_layout()?;
        workspace.ensure_workspace_file()?;
        Ok(workspace)
    }

    pub fn open(root: impl Into<PathBuf>) -> Result<Self, WorkspaceError> {
        let workspace = Self {
            layout: WorkspaceLayout::new(root),
        };
        if !workspace.layout.root().exists() {
            return Err(WorkspaceError::WorkspaceMissing(
                workspace.layout.root().to_path_buf(),
            ));
        }
        workspace.ensure_layout()?;
        workspace.ensure_workspace_file()?;
        Ok(workspace)
    }

    pub fn open_existing(root: impl Into<PathBuf>) -> Result<Self, WorkspaceError> {
        let workspace = Self {
            layout: WorkspaceLayout::new(root),
        };
        if !workspace.layout.root().exists() {
            return Err(WorkspaceError::WorkspaceMissing(
                workspace.layout.root().to_path_buf(),
            ));
        }
        if !workspace.layout.root().is_dir() {
            return Err(WorkspaceError::WorkspaceNotDirectory(
                workspace.layout.root().to_path_buf(),
            ));
        }
        let workspace_file = workspace.layout.workspace_file();
        if !workspace_file.is_file() {
            return Err(WorkspaceError::WorkspaceMarkerMissing(workspace_file));
        }
        let bytes = fs::read(&workspace_file)?;
        let workspace_state: WorkspaceFile = serde_json::from_slice(&bytes)?;
        if workspace_state.schema_version != 1 {
            return Err(WorkspaceError::WorkspaceSchemaUnsupported(
                workspace_state.schema_version,
            ));
        }
        workspace.ensure_layout()?;
        Ok(workspace)
    }

    pub fn layout(&self) -> &WorkspaceLayout {
        &self.layout
    }

    pub fn create_entry(&self, title: impl Into<String>) -> Result<EntryMeta, WorkspaceError> {
        self.create_entry_with_meta(title, BTreeMap::new(), Vec::new())
    }

    pub fn create_entry_with_meta(
        &self,
        title: impl Into<String>,
        fields: BTreeMap<String, String>,
        tags: Vec<TagId>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let mut entry = EntryMeta::new(title)?;
        entry.fields = fields;
        entry.tags = self.normalize_entry_tags(tags)?;
        entry.validate()?;
        let entry_dir = self.layout.entry_dir(&entry.id);
        if entry_dir.exists() {
            return Err(WorkspaceError::EntryAlreadyExists(entry.id.to_string()));
        }
        fs::create_dir_all(&entry_dir)?;
        atomic_write_json(self.layout.entry_meta_file(&entry.id), &entry)?;
        Ok(entry)
    }

    pub fn update_entry_meta(
        &self,
        entry_id: &EntryId,
        title: impl Into<String>,
        fields: BTreeMap<String, String>,
        tags: Vec<TagId>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let mut entry = self.read_entry_meta(entry_id)?;
        entry.title = title.into();
        entry.fields = fields;
        entry.tags = self.normalize_entry_tags(tags)?;
        entry.updated_at = Utc::now();
        entry.validate()?;
        atomic_write_json(self.layout.entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    pub fn delete_entry(&self, entry_id: &EntryId) -> Result<(), WorkspaceError> {
        let entry_dir = self.layout.entry_dir(entry_id);
        if !entry_dir.exists() {
            return Err(WorkspaceError::EntryMissing(entry_id.to_string()));
        }
        let trashed_entry_dir = self.layout.trashed_entry_dir(entry_id);
        if trashed_entry_dir.exists() {
            return Err(WorkspaceError::EntryAlreadyExists(entry_id.to_string()));
        }
        self.mark_entry_trashed(entry_id)?;
        fs::create_dir_all(self.layout.trashed_entries_dir())?;
        fs::rename(entry_dir, trashed_entry_dir)?;
        Ok(())
    }

    pub fn restore_entry(&self, entry_id: &EntryId) -> Result<EntryMeta, WorkspaceError> {
        let entry_dir = self.layout.entry_dir(entry_id);
        if entry_dir.exists() {
            return Err(WorkspaceError::EntryAlreadyExists(entry_id.to_string()));
        }
        let trashed_entry_dir = self.layout.trashed_entry_dir(entry_id);
        if !trashed_entry_dir.exists() {
            return Err(WorkspaceError::EntryMissing(entry_id.to_string()));
        }
        fs::rename(trashed_entry_dir, entry_dir)?;
        let marker = self.layout.entry_dir(entry_id).join(".trashed.json");
        if marker.exists() {
            fs::remove_file(marker)?;
        }
        self.read_entry(entry_id)
    }

    pub fn purge_entry(&self, entry_id: &EntryId) -> Result<(), WorkspaceError> {
        let trashed_entry_dir = self.layout.trashed_entry_dir(entry_id);
        if !trashed_entry_dir.exists() {
            return Err(WorkspaceError::EntryMissing(entry_id.to_string()));
        }
        fs::remove_dir_all(trashed_entry_dir)?;
        Ok(())
    }

    pub fn create_note(
        &self,
        entry_id: &EntryId,
        title: impl Into<String>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let mut entry = self.read_entry_meta(entry_id)?;
        let note_id = NoteId::new();
        let title = normalize_note_title(title.into());
        let note_path = self.layout.entry_note_file(entry_id, &note_id);
        if note_path.exists() {
            return Err(WorkspaceError::NoteAlreadyExists(note_id.to_string()));
        }

        let frontmatter_title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let body = format!(
            "---\nkind: note\nentry_id: {}\nnote_id: {}\ntitle: \"{}\"\n---\n\n# {}\n",
            entry_id.as_str(),
            note_id.as_str(),
            frontmatter_title,
            title
        );
        atomic_write(note_path, body.as_bytes())?;
        entry.contents.push(ContentItem::Note { note_id, title });
        entry.updated_at = Utc::now();
        atomic_write_json(self.layout.entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    pub fn list_tags(&self) -> Result<Vec<TagMeta>, WorkspaceError> {
        Ok(self.read_workspace_file()?.tags)
    }

    pub fn create_tag(
        &self,
        name: impl Into<String>,
        parent_id: Option<TagId>,
    ) -> Result<TagMeta, WorkspaceError> {
        let mut workspace_file = self.read_workspace_file()?;
        let name = name.into().trim().to_string();

        if let Some(parent_id) = &parent_id {
            self.ensure_tag_exists(&workspace_file, parent_id)?;
        }

        if workspace_file
            .tags
            .iter()
            .any(|tag| tag.parent_id == parent_id && tag.name.eq_ignore_ascii_case(name.as_str()))
        {
            return Err(WorkspaceError::TagAlreadyExists(name));
        }

        let tag = TagMeta::new(name, parent_id)?;
        workspace_file.tags.push(tag.clone());
        self.write_workspace_file(&workspace_file)?;
        Ok(tag)
    }

    pub fn rename_tag(
        &self,
        tag_id: &TagId,
        new_name: impl Into<String>,
    ) -> Result<TagMeta, WorkspaceError> {
        let mut workspace_file = self.read_workspace_file()?;
        let new_name = new_name.into().trim().to_string();
        let tag_index = workspace_file
            .tags
            .iter()
            .position(|tag| tag.id == *tag_id)
            .ok_or_else(|| WorkspaceError::TagMissing(tag_id.to_string()))?;
        let parent_id = workspace_file.tags[tag_index].parent_id.clone();

        if workspace_file.tags.iter().any(|tag| {
            tag.id != *tag_id
                && tag.parent_id == parent_id
                && tag.name.eq_ignore_ascii_case(new_name.as_str())
        }) {
            return Err(WorkspaceError::TagAlreadyExists(new_name));
        }

        workspace_file.tags[tag_index].name = new_name;
        workspace_file.tags[tag_index].updated_at = Utc::now();
        workspace_file.tags[tag_index].validate()?;
        let tag = workspace_file.tags[tag_index].clone();
        self.write_workspace_file(&workspace_file)?;
        Ok(tag)
    }

    pub fn delete_tag(&self, tag_id: &TagId) -> Result<(), WorkspaceError> {
        let mut workspace_file = self.read_workspace_file()?;
        self.ensure_tag_exists(&workspace_file, tag_id)?;
        let deleted_ids = collect_descendant_tag_ids(&workspace_file.tags, tag_id);
        workspace_file
            .tags
            .retain(|tag| !deleted_ids.contains(&tag.id));
        self.write_workspace_file(&workspace_file)?;

        for mut entry in self.list_entries()? {
            let original_count = entry.tags.len();
            entry.tags.retain(|tag| !deleted_ids.contains(tag));
            if entry.tags.len() != original_count {
                entry.updated_at = Utc::now();
                atomic_write_json(self.layout.entry_meta_file(&entry.id), &entry)?;
            }
        }

        Ok(())
    }

    pub fn import_pdf(
        &self,
        entry_id: &EntryId,
        src_path: impl Into<PathBuf>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let src_path = src_path.into();
        let mut entry = self.read_entry_meta(entry_id)?;
        if entry.pdf.is_some() {
            return Err(WorkspaceError::PdfAlreadyExists(entry_id.to_string()));
        }

        let bytes = fs::read(&src_path)?;
        atomic_write(self.layout.entry_pdf_file(entry_id), &bytes)?;
        entry.pdf = Some(PdfAsset {
            file_name: src_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("paper.pdf")
                .to_string(),
            content_hash: blake3::hash(&bytes).to_hex().to_string(),
            imported_at: Utc::now(),
            parse: PdfParseState::not_started(),
        });
        entry.updated_at = Utc::now();
        atomic_write_json(self.layout.entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    pub fn rename_pdf_display_name(
        &self,
        entry_id: &EntryId,
        file_name: impl Into<String>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let file_name = file_name.into().trim().to_string();
        if file_name.is_empty() || file_name.contains(['/', '\\']) {
            return Err(WorkspaceError::InvalidPdfDisplayName(file_name));
        }

        let mut entry = self.read_entry_meta(entry_id)?;
        let pdf = entry
            .pdf
            .as_mut()
            .ok_or_else(|| WorkspaceError::PdfMissing(entry_id.to_string()))?;
        pdf.file_name = file_name;
        entry.updated_at = Utc::now();
        atomic_write_json(self.layout.entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    pub fn set_pdf_parse_state(
        &self,
        entry_id: &EntryId,
        status: PdfParseStatus,
        message: Option<String>,
    ) -> Result<EntryMeta, WorkspaceError> {
        self.set_pdf_parse_state_with_task(entry_id, status, message, None, None)
    }

    pub fn set_pdf_parse_state_with_task(
        &self,
        entry_id: &EntryId,
        status: PdfParseStatus,
        message: Option<String>,
        task_id: Option<String>,
        endpoint: Option<String>,
    ) -> Result<EntryMeta, WorkspaceError> {
        let mut entry = self.read_entry_meta(entry_id)?;
        let pdf = entry
            .pdf
            .as_mut()
            .ok_or_else(|| WorkspaceError::PdfMissing(entry_id.to_string()))?;
        if pdf.parse.status != status && !PdfParseState::can_transition(pdf.parse.status, status) {
            return Err(WorkspaceError::InvalidPdfParseTransition(format!(
                "{:?} -> {:?}",
                pdf.parse.status, status
            )));
        }

        let previous_task_id = pdf.parse.task_id.clone();
        let previous_endpoint = pdf.parse.endpoint.clone();
        let (task_id, endpoint) = if status == PdfParseStatus::Queued {
            (task_id, endpoint)
        } else {
            (task_id.or(previous_task_id), endpoint.or(previous_endpoint))
        };
        pdf.parse = PdfParseState {
            status,
            updated_at: Utc::now(),
            message,
            task_id,
            endpoint,
        };
        entry.updated_at = Utc::now();
        atomic_write_json(self.layout.entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    pub fn write_segments(
        &self,
        entry_id: &EntryId,
        segments: &[SourceSegment],
    ) -> Result<(), WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        atomic_write_json(self.layout.entry_segments_file(entry_id), &segments)
    }

    pub fn clear_segments(&self, entry_id: &EntryId) -> Result<(), WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        let path = self.layout.entry_segments_file(entry_id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    pub fn read_entry_translation(
        &self,
        entry_id: &EntryId,
    ) -> Result<Option<EntryTranslation>, WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        let path = self.layout.entry_translation_file(entry_id);
        if !path.exists() {
            return Ok(None);
        }
        let bytes = fs::read(path)?;
        Ok(Some(serde_json::from_slice(&bytes)?))
    }

    pub fn write_entry_translation(
        &self,
        entry_id: &EntryId,
        translation: &EntryTranslation,
    ) -> Result<(), WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        atomic_write_json(self.layout.entry_translation_file(entry_id), translation)
    }

    pub fn write_mineru_output_zip(
        &self,
        entry_id: &EntryId,
        zip_bytes: &[u8],
    ) -> Result<(), WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        self.clear_mineru_outputs(entry_id)?;
        let output_dir = self.layout.entry_mineru_output_dir(entry_id);
        fs::create_dir_all(&output_dir)?;
        atomic_write(self.layout.entry_mineru_output_zip(entry_id), zip_bytes)?;
        self.extract_mineru_output_zip(entry_id, zip_bytes)?;
        self.promote_mineru_output_artifacts(entry_id)
    }

    pub fn write_mineru_output_response(
        &self,
        entry_id: &EntryId,
        response: &Value,
    ) -> Result<(), WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        let output_dir = self.layout.entry_mineru_output_dir(entry_id);
        fs::create_dir_all(&output_dir)?;

        atomic_write_json(output_dir.join("task-result.json"), response)?;

        if let Some(content_list_v2) = find_nested_json_key(response, "content_list_v2") {
            write_json_or_embedded_json(
                output_dir.join("paper_content_list_v2.json"),
                content_list_v2,
            )?;
        }

        if let Some(content_list) = find_nested_json_key(response, "content_list") {
            write_json_or_embedded_json(output_dir.join("paper_content_list.json"), content_list)?;
        }

        if let Some(md_content) = find_nested_json_key(response, "md_content") {
            write_text_value(output_dir.join("paper.md"), md_content)?;
        }

        if let Some(middle_json) = find_nested_json_key(response, "middle_json") {
            write_json_or_embedded_json(output_dir.join("paper_middle.json"), middle_json)?;
        }

        if let Some(model_output) = find_nested_json_key(response, "model_output") {
            write_json_or_embedded_json(output_dir.join("paper_model.json"), model_output)?;
        }

        if let Some(images) = find_nested_json_key(response, "images") {
            write_mineru_images(&output_dir, images)?;
        }

        for key in ["files", "artifacts", "output_files"] {
            if let Some(files) = find_nested_json_key(response, key) {
                write_mineru_embedded_files(&output_dir, files)?;
            }
        }

        self.promote_mineru_output_artifacts(entry_id)
    }

    pub fn read_mineru_middle_json(
        &self,
        entry_id: &EntryId,
    ) -> Result<Option<Value>, WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        let path = self
            .layout
            .entry_mineru_output_dir(entry_id)
            .join("paper_middle.json");
        if !path.exists() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_slice(&fs::read(path)?)?))
    }

    pub fn clear_mineru_outputs(&self, entry_id: &EntryId) -> Result<(), WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        let output_dir = self.layout.entry_mineru_output_dir(entry_id);
        if output_dir.exists() {
            fs::remove_dir_all(output_dir)?;
        }
        Ok(())
    }

    pub fn read_entry(&self, entry_id: &EntryId) -> Result<EntryMeta, WorkspaceError> {
        self.read_entry_meta(entry_id)
    }

    pub fn read_segments(&self, entry_id: &EntryId) -> Result<Vec<SourceSegment>, WorkspaceError> {
        let path = self.layout.entry_segments_file(entry_id);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(path)?;
        let mut segments: Vec<SourceSegment> = serde_json::from_slice(&bytes)?;
        self.enrich_segments_with_empty_mineru_regions(entry_id, &mut segments);
        self.enrich_segments_with_mineru_assets(entry_id, &mut segments);
        Ok(segments)
    }

    pub(crate) fn resolve_source_segment(
        &self,
        entry_id: &EntryId,
        segment_uid: &SegmentUid,
    ) -> Result<SourceSegment, WorkspaceError> {
        self.read_segments(entry_id)?
            .into_iter()
            .find(|segment| {
                segment.uid == *segment_uid
                    || segment
                        .continuation_group_id
                        .as_deref()
                        .is_some_and(|group_id| group_id == segment_uid.as_str())
            })
            .ok_or_else(|| WorkspaceError::SegmentMissing(segment_uid.to_string()))
    }

    pub fn read_segment_notes(
        &self,
        entry_id: &EntryId,
    ) -> Result<Vec<SegmentBlockNote>, WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        let path = self.layout.entry_segment_notes_file(entry_id);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn read_annotations(&self, entry_id: &EntryId) -> Result<Vec<Annotation>, WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        let path = self.layout.entry_annotations_file(entry_id);
        if !path.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn list_annotations(&self) -> Result<Vec<AnnotationIndexRecord>, WorkspaceError> {
        let mut records = Vec::new();

        for entry in self.list_entries()? {
            if !matches!(
                entry.pdf.as_ref().map(|pdf| pdf.parse.status),
                Some(PdfParseStatus::Succeeded)
            ) {
                continue;
            }

            let annotations = self.read_annotations(&entry.id)?;
            if annotations.is_empty() {
                continue;
            }

            let segments_by_uid: HashMap<SegmentUid, SourceSegment> = self
                .read_segments(&entry.id)?
                .into_iter()
                .map(|segment| (segment.uid.clone(), segment))
                .collect();

            for annotation in annotations {
                let segment = segments_by_uid.get(&annotation.segment_uid).cloned();
                records.push(AnnotationIndexRecord::new(
                    entry.id.clone(),
                    entry.title.clone(),
                    entry.tags.clone(),
                    annotation,
                    segment,
                ));
            }
        }

        records.sort_by(|left, right| {
            left.entry_title
                .cmp(&right.entry_title)
                .then_with(|| {
                    left.segment
                        .as_ref()
                        .map(|segment| segment.page_idx)
                        .cmp(&right.segment.as_ref().map(|segment| segment.page_idx))
                })
                .then_with(|| right.annotation.updated_at.cmp(&left.annotation.updated_at))
        });

        Ok(records)
    }

    pub fn create_annotation(
        &self,
        entry_id: &EntryId,
        segment_uid: SegmentUid,
        kind: String,
        content: String,
        importance: AnnotationImportance,
    ) -> Result<Vec<Annotation>, WorkspaceError> {
        self.create_annotation_with_text_selection(
            entry_id,
            segment_uid,
            kind,
            content,
            importance,
            None,
        )
    }

    pub fn create_annotation_with_text_selection(
        &self,
        entry_id: &EntryId,
        segment_uid: SegmentUid,
        kind: String,
        content: String,
        importance: AnnotationImportance,
        text_selection: Option<AnnotationTextSelection>,
    ) -> Result<Vec<Annotation>, WorkspaceError> {
        let segment = self.ensure_segment_annotation_allowed(entry_id, &segment_uid)?;
        let mut annotations = self.read_annotations(entry_id)?;
        let mut annotation = Annotation::new_for_segment(&segment, kind, content, importance);
        annotation.text_selection = text_selection;
        annotations.push(annotation);
        atomic_write_json(self.layout.entry_annotations_file(entry_id), &annotations)?;
        Ok(annotations)
    }

    pub fn update_annotation(
        &self,
        entry_id: &EntryId,
        annotation_id: &AnnotationId,
        kind: String,
        content: String,
        importance: AnnotationImportance,
    ) -> Result<Vec<Annotation>, WorkspaceError> {
        let mut annotations = self.read_annotations(entry_id)?;
        let annotation = annotations
            .iter_mut()
            .find(|annotation| annotation.annotation_id == *annotation_id)
            .ok_or_else(|| WorkspaceError::AnnotationMissing(annotation_id.to_string()))?;
        let segment = self.ensure_segment_annotation_allowed(entry_id, &annotation.segment_uid)?;
        annotation.update(kind, content, importance);
        if annotation.segment_snapshot.is_none() {
            annotation.refresh_segment_snapshot(&segment);
        }
        atomic_write_json(self.layout.entry_annotations_file(entry_id), &annotations)?;
        Ok(annotations)
    }

    pub fn delete_annotation(
        &self,
        entry_id: &EntryId,
        annotation_id: &AnnotationId,
    ) -> Result<Vec<Annotation>, WorkspaceError> {
        let mut annotations = self.read_annotations(entry_id)?;
        let deleted = annotations
            .iter()
            .find(|annotation| annotation.annotation_id == *annotation_id)
            .cloned()
            .ok_or_else(|| WorkspaceError::AnnotationMissing(annotation_id.to_string()))?;
        self.store_deleted_annotation(entry_id, deleted)?;
        annotations.retain(|annotation| annotation.annotation_id != *annotation_id);
        atomic_write_json(self.layout.entry_annotations_file(entry_id), &annotations)?;
        Ok(annotations)
    }

    pub fn upsert_segment_note(
        &self,
        entry_id: &EntryId,
        segment_uid: SegmentUid,
        text: String,
    ) -> Result<Vec<SegmentBlockNote>, WorkspaceError> {
        let segment_uid = self.resolve_source_segment(entry_id, &segment_uid)?.uid;
        let mut notes = self.read_segment_notes(entry_id)?;
        if let Some(note) = notes
            .iter_mut()
            .find(|note| note.segment_uid == segment_uid)
        {
            note.update_text(text);
        } else {
            notes.push(SegmentBlockNote::new(segment_uid, text));
        }
        atomic_write_json(self.layout.entry_segment_notes_file(entry_id), &notes)?;
        Ok(notes)
    }

    pub fn delete_segment_note(
        &self,
        entry_id: &EntryId,
        segment_uid: SegmentUid,
    ) -> Result<Vec<SegmentBlockNote>, WorkspaceError> {
        let segment_uid = self.resolve_source_segment(entry_id, &segment_uid)?.uid;
        let mut notes = self.read_segment_notes(entry_id)?;
        let deleted = notes
            .iter()
            .find(|note| note.segment_uid == segment_uid)
            .cloned()
            .ok_or_else(|| WorkspaceError::SegmentMissing(segment_uid.to_string()))?;
        self.store_deleted_segment_note(entry_id, deleted)?;
        notes.retain(|note| note.segment_uid != segment_uid);
        atomic_write_json(self.layout.entry_segment_notes_file(entry_id), &notes)?;
        Ok(notes)
    }

    pub fn entry_pdf_path(&self, entry_id: &EntryId) -> Result<PathBuf, WorkspaceError> {
        self.read_entry_meta(entry_id)?;
        Ok(self.layout.entry_pdf_file(entry_id))
    }

    fn ensure_segment_annotation_allowed(
        &self,
        entry_id: &EntryId,
        segment_uid: &SegmentUid,
    ) -> Result<SourceSegment, WorkspaceError> {
        let entry = self.read_entry_meta(entry_id)?;
        let parse_status = entry.pdf.as_ref().map(|pdf| pdf.parse.status);
        if parse_status != Some(PdfParseStatus::Succeeded) {
            return Err(WorkspaceError::PdfNotParsed(entry_id.to_string()));
        }
        self.resolve_source_segment(entry_id, segment_uid)
    }

    fn enrich_segments_with_empty_mineru_regions(
        &self,
        entry_id: &EntryId,
        segments: &mut Vec<SourceSegment>,
    ) {
        let empty_regions = self
            .read_empty_mineru_paragraph_regions(entry_id)
            .unwrap_or_default();

        for empty_region in empty_regions {
            if segments.iter().any(|segment| {
                segment.page_idx == empty_region.page_idx
                    && segment.segment_type == SegmentType::Paragraph
                    && (bboxes_match(segment.bbox, Some(empty_region.bbox))
                        || non_empty_segment_overlaps_empty_region(segment, empty_region.bbox))
            }) {
                continue;
            }

            segments.push(SourceSegment {
                uid: SegmentUid::from_string(format!(
                    "mineru-empty-v2-p{}-{:.0}-{:.0}-{:.0}-{:.0}",
                    empty_region.page_idx,
                    empty_region.bbox[0],
                    empty_region.bbox[1],
                    empty_region.bbox[2],
                    empty_region.bbox[3]
                )),
                segment_type: SegmentType::Paragraph,
                page_idx: empty_region.page_idx,
                bbox: Some(empty_region.bbox),
                text: String::new(),
                markdown: None,
                asset_path: None,
                raw_type: Some("paragraph".to_string()),
                sub_type: None,
                block_role: None,
                mineru_metadata: Default::default(),
                continuation_group_id: None,
                visual_group_id: None,
            });
        }
    }

    fn read_empty_mineru_paragraph_regions(
        &self,
        entry_id: &EntryId,
    ) -> Result<Vec<EmptyMineruRegion>, WorkspaceError> {
        let output_dir = self.layout.entry_mineru_output_dir(entry_id);
        if !output_dir.exists() {
            return Ok(Vec::new());
        }

        let mut regions = Vec::new();
        for entry in fs::read_dir(output_dir)? {
            let path = entry?.path();
            if !path.is_file() {
                continue;
            }

            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !file_name.ends_with("_content_list_v2.json") {
                continue;
            }

            let value = serde_json::from_slice::<Value>(&fs::read(path)?)?;
            collect_empty_mineru_paragraph_regions(&value, &mut regions);
        }

        Ok(regions)
    }

    fn enrich_segments_with_mineru_assets(
        &self,
        entry_id: &EntryId,
        segments: &mut Vec<SourceSegment>,
    ) {
        let asset_refs = self.read_mineru_asset_refs(entry_id).unwrap_or_default();

        for segment in segments.iter_mut() {
            if segment.asset_path.is_none() {
                segment.asset_path = mineru_asset_path_from_text(
                    segment.markdown.as_deref().unwrap_or(segment.text.as_str()),
                );
            }
            let existing_asset_path = segment.asset_path.clone();

            let best = asset_refs
                .iter()
                .filter(|asset_ref| {
                    asset_ref.page_idx == segment.page_idx
                        && asset_ref.segment_type == segment.segment_type
                        && existing_asset_path
                            .as_deref()
                            .is_none_or(|path| path == asset_ref.asset_path)
                })
                .filter_map(|asset_ref| {
                    asset_ref
                        .match_score(segment)
                        .map(|score| (score, asset_ref))
                })
                .min_by_key(|(score, _)| *score);

            if let Some((_, asset_ref)) = best {
                if segment.asset_path.is_none() {
                    segment.asset_path = Some(asset_ref.asset_path.clone());
                }
                if segment.raw_type.is_none() {
                    segment.raw_type = Some(asset_ref.raw_type.clone());
                }
                if segment.sub_type.is_none() {
                    segment.sub_type = asset_ref.sub_type.clone();
                }
                if segment.block_role.is_none() {
                    segment.block_role = Some("body".to_string());
                }
                if segment.visual_group_id.is_none() {
                    segment.visual_group_id = asset_ref.visual_group_id();
                }
                enrich_visual_segment_text(segment, asset_ref);
            }
        }
    }

    fn read_mineru_asset_refs(
        &self,
        entry_id: &EntryId,
    ) -> Result<Vec<MineruAssetRef>, WorkspaceError> {
        let output_dir = self.layout.entry_mineru_output_dir(entry_id);
        if !output_dir.exists() {
            return Ok(Vec::new());
        }

        let mut asset_refs = Vec::new();
        for entry in fs::read_dir(output_dir)? {
            let path = entry?.path();
            if !path.is_file() {
                continue;
            }

            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !file_name.ends_with("_content_list.json")
                && !file_name.ends_with("_content_list_v2.json")
            {
                continue;
            }

            let value = serde_json::from_slice::<Value>(&fs::read(path)?)?;
            collect_mineru_asset_refs(&value, &mut asset_refs);
        }

        Ok(asset_refs)
    }

    pub fn list_entries(&self) -> Result<Vec<EntryMeta>, WorkspaceError> {
        self.list_entries_in_dir(self.layout.entries_dir())
    }

    pub fn list_trashed_entries(&self) -> Result<Vec<EntryMeta>, WorkspaceError> {
        self.list_entries_in_dir(self.layout.trashed_entries_dir())
    }

    fn list_entries_in_dir(&self, entries_dir: PathBuf) -> Result<Vec<EntryMeta>, WorkspaceError> {
        if !entries_dir.exists() {
            return Ok(Vec::new());
        }

        let mut entries = Vec::new();
        for entry in fs::read_dir(entries_dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let meta_path = entry.path().join("entry.meta.json");
            if !meta_path.exists() {
                continue;
            }
            let bytes = fs::read(meta_path)?;
            entries.push(serde_json::from_slice(&bytes)?);
        }

        entries
            .sort_by(|left: &EntryMeta, right: &EntryMeta| right.updated_at.cmp(&left.updated_at));
        Ok(entries)
    }

    fn normalize_entry_tags(&self, tags: Vec<TagId>) -> Result<Vec<TagId>, WorkspaceError> {
        let workspace_file = self.read_workspace_file()?;
        let mut unique_tags = Vec::new();
        let mut seen = BTreeSet::new();

        for tag_id in tags {
            if !seen.insert(tag_id.clone()) {
                continue;
            }
            self.ensure_tag_exists(&workspace_file, &tag_id)?;
            unique_tags.push(tag_id);
        }

        Ok(unique_tags)
    }

    fn ensure_tag_exists(
        &self,
        workspace_file: &WorkspaceFile,
        tag_id: &TagId,
    ) -> Result<(), WorkspaceError> {
        if workspace_file.tags.iter().any(|tag| tag.id == *tag_id) {
            return Ok(());
        }
        Err(WorkspaceError::TagMissing(tag_id.to_string()))
    }

    fn read_workspace_file(&self) -> Result<WorkspaceFile, WorkspaceError> {
        let path = self.layout.workspace_file();
        if !path.exists() {
            return Ok(WorkspaceFile::default());
        }
        let bytes = fs::read(path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn write_workspace_file(&self, workspace_file: &WorkspaceFile) -> Result<(), WorkspaceError> {
        atomic_write_json(self.layout.workspace_file(), workspace_file)
    }

    fn promote_mineru_output_artifacts(&self, entry_id: &EntryId) -> Result<(), WorkspaceError> {
        let output_dir = self.layout.entry_mineru_output_dir(entry_id);
        if !output_dir.exists() {
            return Ok(());
        }

        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper.md"),
            &[".md"],
            &["_layout.pdf", "_span.pdf"],
        )?;
        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper_middle.json"),
            &["_middle.json"],
            &[],
        )?;
        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper_model.json"),
            &["_model.json"],
            &[],
        )?;
        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper_content_list.json"),
            &["_content_list.json"],
            &["_content_list_v2.json"],
        )?;
        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper_content_list_v2.json"),
            &["_content_list_v2.json"],
            &[],
        )?;
        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper_layout.pdf"),
            &["_layout.pdf"],
            &[],
        )?;
        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper_span.pdf"),
            &["_span.pdf"],
            &[],
        )?;
        promote_first_matching_file(
            &output_dir,
            &output_dir.join("paper_origin.pdf"),
            &["_origin.pdf"],
            &[],
        )?;
        promote_images_to_root(&output_dir)?;

        Ok(())
    }

    fn extract_mineru_output_zip(
        &self,
        entry_id: &EntryId,
        zip_bytes: &[u8],
    ) -> Result<(), WorkspaceError> {
        let output_dir = self.layout.entry_mineru_output_dir(entry_id);
        let mut archive = ZipArchive::new(Cursor::new(zip_bytes))?;

        for index in 0..archive.len() {
            let mut file = archive.by_index(index)?;
            let Some(enclosed_name) = file.enclosed_name() else {
                continue;
            };
            let output_path = output_dir.join(enclosed_name);

            if file.is_dir() {
                fs::create_dir_all(&output_path)?;
                continue;
            }

            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output = fs::File::create(output_path)?;
            std::io::copy(&mut file, &mut output)?;
        }

        Ok(())
    }

    fn read_entry_meta(&self, entry_id: &EntryId) -> Result<EntryMeta, WorkspaceError> {
        let meta_path = self.layout.entry_meta_file(entry_id);
        if !meta_path.exists() {
            return Err(WorkspaceError::EntryMissing(entry_id.to_string()));
        }
        let bytes = fs::read(meta_path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn ensure_layout(&self) -> Result<(), WorkspaceError> {
        fs::create_dir_all(self.layout.entries_dir())?;
        fs::create_dir_all(self.layout.trashed_entries_dir())?;
        fs::create_dir_all(self.layout.conversations_dir())?;
        fs::create_dir_all(self.layout.cache_dir())?;
        Ok(())
    }

    fn ensure_workspace_file(&self) -> Result<(), WorkspaceError> {
        let workspace_file = self.layout.workspace_file();
        if !workspace_file.exists() {
            atomic_write_json(workspace_file, &WorkspaceFile::default())?;
        }
        Ok(())
    }
}

fn normalize_note_title(title: String) -> String {
    let title = title.trim();
    if title.is_empty() {
        "Untitled note".to_string()
    } else {
        title.to_string()
    }
}

fn collect_descendant_tag_ids(tags: &[TagMeta], tag_id: &TagId) -> BTreeSet<TagId> {
    let mut collected = BTreeSet::from([tag_id.clone()]);
    let mut changed = true;

    while changed {
        changed = false;
        for tag in tags {
            if tag
                .parent_id
                .as_ref()
                .is_some_and(|parent_id| collected.contains(parent_id))
                && collected.insert(tag.id.clone())
            {
                changed = true;
            }
        }
    }

    collected
}

#[derive(Clone, Debug)]
struct MineruAssetRef {
    segment_type: SegmentType,
    page_idx: u32,
    bbox: Option<[f32; 4]>,
    text: Option<String>,
    caption_text: Option<String>,
    asset_path: String,
    raw_type: String,
    sub_type: Option<String>,
}

impl MineruAssetRef {
    fn match_score(&self, segment: &SourceSegment) -> Option<u32> {
        self.bbox_match_score(segment.bbox)
            .or_else(|| self.text_match_score(segment))
    }

    fn visual_group_id(&self) -> Option<String> {
        let [x0, y0, x1, y1] = self.bbox?;
        Some(format!(
            "visual-{}-p{}-{:.0}-{:.0}-{:.0}-{:.0}",
            self.raw_type, self.page_idx, x0, y0, x1, y1
        ))
    }

    fn bbox_match_score(&self, segment_bbox: Option<[f32; 4]>) -> Option<u32> {
        let asset_bbox = self.bbox?;
        let segment_bbox = segment_bbox?;
        let max_delta = asset_bbox
            .iter()
            .zip(segment_bbox.iter())
            .map(|(left, right)| (left - right).abs())
            .fold(0.0_f32, f32::max);

        if max_delta <= 8.0 {
            Some((max_delta * 10.0).round() as u32)
        } else {
            None
        }
    }

    fn text_match_score(&self, segment: &SourceSegment) -> Option<u32> {
        let asset_text = normalize_match_text(self.text.as_deref()?);
        let segment_text =
            normalize_match_text(segment.markdown.as_deref().unwrap_or(segment.text.as_str()));

        if asset_text.is_empty() || segment_text.is_empty() {
            return None;
        }
        if asset_text == segment_text {
            return Some(200);
        }
        if asset_text.len() > 32 && segment_text.contains(asset_text.as_str()) {
            return Some(250);
        }
        if segment_text.len() > 32 && asset_text.contains(segment_text.as_str()) {
            return Some(250);
        }
        None
    }
}

#[derive(Clone, Copy, Debug)]
struct EmptyMineruRegion {
    page_idx: u32,
    bbox: [f32; 4],
}

fn collect_empty_mineru_paragraph_regions(value: &Value, regions: &mut Vec<EmptyMineruRegion>) {
    let Some(pages) = value.as_array() else {
        return;
    };

    for (page_idx, page) in pages.iter().enumerate() {
        let Some(blocks) = page.as_array() else {
            continue;
        };
        for block in blocks {
            if empty_mineru_paragraph_region_from_v2_block(block) {
                if let Some(bbox) = bbox_from_value(block.get("bbox")) {
                    regions.push(EmptyMineruRegion {
                        page_idx: page_idx as u32,
                        bbox,
                    });
                }
            }
        }
    }
}

fn empty_mineru_paragraph_region_from_v2_block(block: &Value) -> bool {
    if block.get("type").and_then(Value::as_str) != Some("paragraph") {
        return false;
    }

    block
        .get("content")
        .and_then(|content| content.get("paragraph_content"))
        .and_then(Value::as_array)
        .is_some_and(|items| items.is_empty())
}

fn bboxes_match(left: Option<[f32; 4]>, right: Option<[f32; 4]>) -> bool {
    let Some(left) = left else {
        return right.is_none();
    };
    let Some(right) = right else {
        return false;
    };

    left.iter()
        .zip(right.iter())
        .all(|(left, right)| (left - right).abs() <= 1.0)
}

fn non_empty_segment_overlaps_empty_region(segment: &SourceSegment, empty_bbox: [f32; 4]) -> bool {
    if segment.text.trim().is_empty() {
        return false;
    }

    let Some(segment_bbox) = segment.bbox else {
        return false;
    };

    bbox_overlap_ratio(segment_bbox, empty_bbox) >= 0.72
}

fn bbox_overlap_ratio(left: [f32; 4], right: [f32; 4]) -> f32 {
    let overlap_width = (left[2].min(right[2]) - left[0].max(right[0])).max(0.0);
    let overlap_height = (left[3].min(right[3]) - left[1].max(right[1])).max(0.0);
    let overlap_area = overlap_width * overlap_height;
    let left_area = bbox_area(left);
    let right_area = bbox_area(right);
    let smaller_area = left_area.min(right_area);

    if smaller_area <= 0.0 {
        return 0.0;
    }

    overlap_area / smaller_area
}

fn bbox_area(bbox: [f32; 4]) -> f32 {
    (bbox[2] - bbox[0]).max(0.0) * (bbox[3] - bbox[1]).max(0.0)
}

fn collect_mineru_asset_refs(value: &Value, asset_refs: &mut Vec<MineruAssetRef>) {
    match value {
        Value::Array(items) => {
            for item in items {
                if item.get("type").is_some() {
                    if let Some(asset_ref) = mineru_asset_ref_from_content_list_block(item) {
                        asset_refs.push(asset_ref);
                    }
                } else {
                    collect_mineru_asset_refs(item, asset_refs);
                }
            }
        }
        Value::Object(map) => {
            for key in ["content_list", "content"] {
                if let Some(nested) = map.get(key) {
                    collect_mineru_asset_refs(nested, asset_refs);
                }
            }
        }
        _ => {}
    }
}

fn mineru_asset_ref_from_content_list_block(block: &Value) -> Option<MineruAssetRef> {
    let block_type = block.get("type")?.as_str()?;
    let segment_type = match block_type {
        "table" => SegmentType::Table,
        "image" | "chart" => SegmentType::Figure,
        _ => return None,
    };
    let asset_path = mineru_asset_path_from_block(block)?;
    let content = block.get("content").unwrap_or(block);

    Some(MineruAssetRef {
        segment_type,
        page_idx: block.get("page_idx").and_then(Value::as_u64).unwrap_or(0) as u32,
        bbox: bbox_from_value(block.get("bbox")),
        text: mineru_asset_text_from_block(block_type, content),
        caption_text: mineru_asset_caption_text_from_block(block_type, content),
        asset_path,
        raw_type: block_type.to_string(),
        sub_type: block
            .get("sub_type")
            .and_then(Value::as_str)
            .map(ToString::to_string),
    })
}

fn mineru_asset_path_from_block(block: &Value) -> Option<String> {
    let content = block.get("content").unwrap_or(block);
    string_field(content, "img_path")
        .or_else(|| string_field(block, "image_path"))
        .or_else(|| string_field(content, "image_path"))
        .or_else(|| nested_string_field(content, &["image_source", "path"]))
        .and_then(non_empty)
}

fn mineru_asset_text_from_block(block_type: &str, block: &Value) -> Option<String> {
    let body = match block_type {
        "table" => string_field(block, "table_body").or_else(|| string_field(block, "html")),
        "image" => mineru_asset_path_from_block(block),
        "chart" => string_field(block, "content").or_else(|| string_field(block, "chart_content")),
        _ => None,
    };
    let caption = mineru_asset_caption_text_from_block(block_type, block);
    let footnote = mineru_asset_footnote_text_from_block(block_type, block);
    let mut parts = Vec::new();

    if let Some(body) = body {
        parts.push(body);
    }
    if let Some(caption) = caption {
        parts.push(caption);
    }
    if let Some(footnote) = footnote {
        parts.push(footnote);
    }

    non_empty(parts.join("\n\n")).or_else(|| match block_type {
        "table" => string_array_field(block, "table_caption")
            .or_else(|| inline_items_text(block.get("table_caption")?))
            .or_else(|| string_array_field(block, "table_footnote"))
            .or_else(|| inline_items_text(block.get("table_footnote")?)),
        "image" => string_array_field(block, "image_caption")
            .or_else(|| inline_items_text(block.get("image_caption")?))
            .or_else(|| string_array_field(block, "image_footnote"))
            .or_else(|| inline_items_text(block.get("image_footnote")?)),
        "chart" => string_array_field(block, "chart_caption")
            .or_else(|| inline_items_text(block.get("chart_caption")?))
            .or_else(|| string_array_field(block, "chart_footnote"))
            .or_else(|| inline_items_text(block.get("chart_footnote")?)),
        _ => None,
    })
}

fn mineru_asset_caption_text_from_block(block_type: &str, block: &Value) -> Option<String> {
    match block_type {
        "table" => string_array_field(block, "table_caption")
            .or_else(|| inline_items_text(block.get("table_caption")?)),
        "image" => string_array_field(block, "image_caption")
            .or_else(|| inline_items_text(block.get("image_caption")?)),
        "chart" => string_array_field(block, "chart_caption")
            .or_else(|| inline_items_text(block.get("chart_caption")?)),
        _ => None,
    }
}

fn mineru_asset_footnote_text_from_block(block_type: &str, block: &Value) -> Option<String> {
    match block_type {
        "table" => string_array_field(block, "table_footnote")
            .or_else(|| inline_items_text(block.get("table_footnote")?)),
        "image" => string_array_field(block, "image_footnote")
            .or_else(|| inline_items_text(block.get("image_footnote")?)),
        "chart" => string_array_field(block, "chart_footnote")
            .or_else(|| inline_items_text(block.get("chart_footnote")?)),
        _ => None,
    }
}

fn enrich_visual_segment_text(segment: &mut SourceSegment, asset_ref: &MineruAssetRef) {
    let Some(asset_text) = asset_ref.text.as_deref() else {
        return;
    };

    let current = segment.markdown.as_deref().unwrap_or(segment.text.as_str());
    if current.contains(asset_text) {
        return;
    }

    if let Some(caption_text) = asset_ref.caption_text.as_deref() {
        if current.contains(caption_text) {
            return;
        }
    }

    if segment.text.trim().is_empty() || mineru_asset_path_from_text(&segment.text).is_some() {
        segment.text = asset_text.to_string();
    } else {
        segment.text = format!("{}\n\n{}", segment.text.trim(), asset_text);
    }
}

fn mineru_asset_path_from_text(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches(['<', '>']);
    if is_mineru_asset_path(trimmed) {
        return Some(trimmed.to_string());
    }

    if let Some(markdown_image_path) = trimmed
        .strip_prefix("![](")
        .and_then(|rest| rest.strip_suffix(')'))
        .map(str::trim)
        .filter(|path| is_mineru_asset_path(path))
    {
        return Some(markdown_image_path.to_string());
    }

    None
}

fn is_mineru_asset_path(value: &str) -> bool {
    let lower = value.trim().replace('\\', "/").to_ascii_lowercase();
    lower.starts_with("images/")
        && [".png", ".jpg", ".jpeg", ".webp", ".gif"]
            .iter()
            .any(|extension| lower.ends_with(extension))
}

fn find_nested_json_key<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(map) => {
            if let Some(found) = map.get(key) {
                return Some(found);
            }
            for nested in map.values() {
                if let Some(found) = find_nested_json_key(nested, key) {
                    return Some(found);
                }
            }
            None
        }
        Value::Array(items) => items
            .iter()
            .find_map(|item| find_nested_json_key(item, key)),
        _ => None,
    }
}

fn write_json_or_embedded_json(path: PathBuf, value: &Value) -> Result<(), WorkspaceError> {
    if let Some(text) = value.as_str() {
        if let Ok(parsed) = serde_json::from_str::<Value>(text) {
            return atomic_write_json(path, &parsed);
        }
    }
    atomic_write_json(path, value)
}

fn write_text_value(path: PathBuf, value: &Value) -> Result<(), WorkspaceError> {
    if let Some(text) = value.as_str() {
        return atomic_write(path, text.as_bytes());
    }
    atomic_write(path, value.to_string().as_bytes())
}

fn promote_first_matching_file(
    root: &std::path::Path,
    destination: &std::path::Path,
    include_suffixes: &[&str],
    exclude_suffixes: &[&str],
) -> Result<(), WorkspaceError> {
    let Some(source) = find_first_matching_file(root, include_suffixes, exclude_suffixes)? else {
        return Ok(());
    };

    if source == destination {
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    let bytes = fs::read(source)?;
    atomic_write(destination, &bytes)?;
    Ok(())
}

fn find_first_matching_file(
    root: &std::path::Path,
    include_suffixes: &[&str],
    exclude_suffixes: &[&str],
) -> Result<Option<PathBuf>, WorkspaceError> {
    let mut stack = vec![root.to_path_buf()];

    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if exclude_suffixes
                .iter()
                .any(|suffix| file_name.ends_with(suffix))
            {
                continue;
            }
            if include_suffixes
                .iter()
                .any(|suffix| file_name.ends_with(suffix))
            {
                return Ok(Some(path));
            }
        }
    }

    Ok(None)
}

fn promote_images_to_root(root: &std::path::Path) -> Result<(), WorkspaceError> {
    let mut stack = vec![root.to_path_buf()];
    let images_root = root.join("images");
    fs::create_dir_all(&images_root)?;

    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(dir)? {
            let path = entry?.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }

            let Some(parent) = path.parent() else {
                continue;
            };
            let Some(parent_name) = parent.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !parent_name.eq_ignore_ascii_case("images") {
                continue;
            }

            let Some(file_name) = path.file_name() else {
                continue;
            };
            let destination = images_root.join(file_name);
            if destination == path {
                continue;
            }
            let bytes = fs::read(path)?;
            atomic_write(destination, &bytes)?;
        }
    }

    Ok(())
}

fn write_mineru_images(output_dir: &std::path::Path, images: &Value) -> Result<(), WorkspaceError> {
    let Some(image_map) = images.as_object() else {
        return Ok(());
    };

    let images_dir = output_dir.join("images");
    fs::create_dir_all(&images_dir)?;

    for (name, payload) in image_map {
        let Some(bytes) = decode_mineru_image_payload(payload) else {
            continue;
        };

        let relative = normalize_mineru_image_relative_path(name);
        let output_path = output_dir.join(relative);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write(output_path, &bytes)?;
    }

    Ok(())
}

fn write_mineru_embedded_files(
    output_dir: &std::path::Path,
    files: &Value,
) -> Result<(), WorkspaceError> {
    let Some(file_map) = files.as_object() else {
        return Ok(());
    };

    for (name, payload) in file_map {
        let relative = safe_mineru_artifact_path(name);
        let Some(relative) = relative else {
            continue;
        };
        let output_path = output_dir.join(relative);
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }
        atomic_write(output_path, &mineru_artifact_bytes(payload)?)?;
    }
    Ok(())
}

fn safe_mineru_artifact_path(name: &str) -> Option<PathBuf> {
    let normalized = PathBuf::from(name.trim().trim_start_matches(['/', '\\']));
    if normalized.as_os_str().is_empty()
        || normalized.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
    {
        return None;
    }
    Some(normalized)
}

fn mineru_artifact_bytes(payload: &Value) -> Result<Vec<u8>, WorkspaceError> {
    if let Some(text) = payload.as_str() {
        if text.contains("base64,") {
            return Ok(
                decode_mineru_image_payload(payload).unwrap_or_else(|| text.as_bytes().to_vec())
            );
        }
        return Ok(text.as_bytes().to_vec());
    }
    if let Some(object) = payload.as_object() {
        for key in ["base64", "data", "content"] {
            if let Some(value) = object.get(key) {
                return mineru_artifact_bytes(value);
            }
        }
    }
    Ok(serde_json::to_vec_pretty(payload)?)
}

fn decode_mineru_image_payload(payload: &Value) -> Option<Vec<u8>> {
    let text = payload.as_str()?.trim();
    let base64 = text
        .split_once("base64,")
        .map(|(_, value)| value)
        .unwrap_or(text);
    STANDARD.decode(base64).ok()
}

fn normalize_mineru_image_relative_path(name: &str) -> PathBuf {
    let trimmed = name.trim().trim_start_matches(['/', '\\']);
    let normalized = trimmed.replace('\\', "/");
    if normalized.to_ascii_lowercase().starts_with("images/") {
        PathBuf::from(normalized)
    } else {
        PathBuf::from("images").join(normalized)
    }
}

fn bbox_from_value(value: Option<&Value>) -> Option<[f32; 4]> {
    let values = value?.as_array()?;
    if values.len() != 4 {
        return None;
    }
    Some([
        values[0].as_f64()? as f32,
        values[1].as_f64()? as f32,
        values[2].as_f64()? as f32,
        values[3].as_f64()? as f32,
    ])
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .and_then(non_empty)
}

fn string_array_field(value: &Value, key: &str) -> Option<String> {
    let text = value
        .get(key)?
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .collect::<Vec<_>>()
        .join("\n");
    non_empty(text)
}

fn inline_items_text(value: &Value) -> Option<String> {
    let items = value.as_array()?;
    let text = items
        .iter()
        .filter_map(|item| {
            item.get("content")
                .and_then(Value::as_str)
                .or_else(|| item.get("text").and_then(Value::as_str))
        })
        .collect::<Vec<_>>()
        .join("");
    non_empty(text)
}

fn nested_string_field(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for key in path {
        current = current.get(*key)?;
    }
    current
        .as_str()
        .map(ToString::to_string)
        .and_then(non_empty)
}

fn normalize_match_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn non_empty(value: String) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct WorkspaceFile {
    #[serde(default)]
    schema_version: u16,
    #[serde(default)]
    tags: Vec<TagMeta>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EntryTranslation {
    pub schema_version: u16,
    pub entry_id: EntryId,
    pub source_language: String,
    pub target_language: String,
    pub status: TranslationStatus,
    pub progress: TranslationProgress,
    pub paper_context: Option<TranslationPaperContext>,
    pub segments: Vec<TranslatedSegment>,
    pub model: Option<String>,
    pub error: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TranslationStatus {
    Idle,
    Running,
    Succeeded,
    Failed,
    Partial,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TranslationProgress {
    pub total: usize,
    pub translated: usize,
    pub skipped: usize,
    pub failed: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TranslationPaperContext {
    pub summary: String,
    pub terminology: Vec<TranslationTerm>,
    pub generated_at: chrono::DateTime<Utc>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TranslationTerm {
    pub source: String,
    pub target: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TranslatedSegment {
    pub segment_uid: SegmentUid,
    pub page_idx: u32,
    pub segment_type: SegmentType,
    pub source_hash: String,
    pub source_text: String,
    pub translated_text: Option<String>,
    pub status: TranslatedSegmentStatus,
    pub error: Option<String>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TranslatedSegmentStatus {
    Pending,
    Translated,
    Skipped,
    Failed,
}

impl Default for WorkspaceFile {
    fn default() -> Self {
        Self {
            schema_version: 1,
            tags: Vec::new(),
        }
    }
}

#[cfg(test)]
#[path = "workspace_tests.rs"]
mod workspace_tests;
