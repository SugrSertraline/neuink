use super::{decode, entity, id, invalid, references, Exporter};
use neuink_domain::{Annotation, ContentItem, EntryMeta, LinkOwner, SourceLink, SourceSegment};
use neuink_sync_protocol::ObjectKind;
use serde_json::json;
use std::{collections::BTreeSet, io};

impl Exporter {
    pub(super) fn parse(&mut self, entry_id: &str) -> io::Result<bool> {
        let Some(bytes) = self
            .files
            .read_optional(&format!("entries/{entry_id}/paper.segments.json"))?
        else {
            return Ok(false);
        };
        let mut segments: Vec<SourceSegment> = decode(&bytes)?;
        let marker = self
            .files
            .read_optional(&format!("entries/{entry_id}/paper.reading-snapshot.json"))?;
        let normalized = marker
            .map(|m| crate::workspace::reading_snapshot::matches(&m, &bytes))
            .transpose()
            .map_err(io::Error::other)?
            .unwrap_or(false);
        if !normalized {
            let directory = format!("entries/{entry_id}/mineru-output");
            let mut sources = Vec::new();
            for name in self.files.list(&directory)? {
                if name.ends_with("_content_list.json") || name.ends_with("_content_list_v2.json") {
                    sources.push((
                        name.clone(),
                        decode(&self.files.read(&format!("{directory}/{name}"))?)?,
                    ));
                }
            }
            crate::workspace::reading_snapshot::materialize(&mut segments, &sources);
            if let Some(middle) = self
                .files
                .read_optional(&format!("{directory}/paper_middle.json"))?
            {
                let placeholders = segments
                    .iter()
                    .filter(|segment| segment.asset_path.as_deref() == Some("images/"))
                    .map(|segment| segment.uid.clone())
                    .collect::<Vec<_>>();
                let mut document = neuink_domain::NeuinkDocument::new(segments);
                neuink_parser::enrich_document_with_middle(&mut document, &decode(&middle)?);
                if document.segments.iter().any(|segment| {
                    placeholders.contains(&segment.uid)
                        && segment.asset_path.as_deref() != Some("images/")
                }) {
                    self.notice("recovered_image_reference", entry_id, "已按同页同区域的唯一原始解析记录补全旧图片地址；同步前仍核验图片文件，原始资料未修改");
                }
                segments = document.segments;
            }
        }
        if segments.is_empty() {
            return Err(invalid("解析快照为空，保留原解析包等待修复"));
        }
        let mut ids = BTreeSet::new();
        let mut resources = Vec::new();
        for segment in &mut segments {
            if segment.uid.as_str().is_empty() || !ids.insert(segment.uid.to_string()) {
                return Err(invalid("解析片段标识缺失或重复"));
            }
            if let Some(bbox) = segment.bbox {
                references::validate_bbox(bbox)?;
            }
            if super::metadata::sanitize(&mut segment.mineru_metadata)? {
                // Provider raw objects may contain local paths or credentials.
                // Rendering fields above remain; raw package is not discardable.
                self.notice(
                    "raw_metadata_retained_locally",
                    entry_id,
                    "未导出解析器原始扩展字段；原解析包仍保留，尚不能省略恢复材料",
                );
            }
            self.parse_asset(entry_id, segment.asset_path.as_deref(), &mut resources)?;
            self.markdown_assets(entry_id, None, &segment.text, &mut resources)?;
            if let Some(markdown) = &segment.markdown {
                self.markdown_assets(entry_id, None, markdown, &mut resources)?;
            }
            if let Some(regions) = segment.mineru_metadata.get("list_item_regions") {
                for region in decode::<Vec<super::metadata::ListItemRegion>>(regions.as_bytes())? {
                    self.markdown_assets(entry_id, None, &region.text, &mut resources)?;
                }
            }
        }
        let snapshot =
            json!({"schema_version":1, "format":"neuink.source-segments", "segments":segments});
        resources.push(self.files.generated(
            "segments.json",
            serde_json::to_vec(&snapshot).map_err(io::Error::other)?,
        ));
        self.document(entity("parse", entry_id), ObjectKind::ParseSnapshot,
            json!({"entry_id":entry_id,"format":"neuink.source-segments","format_version":1,"segments_resource":"segments.json","segment_count":segments.len()}),
            resources, vec![entity("entry", entry_id)])?;
        Ok(true)
    }

    pub(super) fn notes(&mut self, entry: &EntryMeta) -> io::Result<()> {
        for ContentItem::Note { note_id, title } in &entry.contents {
            id(note_id.as_str())?;
            let base = format!("entries/{}/notes/{note_id}", entry.id);
            let bytes = self.files.read(&format!("{base}.md"))?;
            let markdown = crate::note::strip_frontmatter(
                std::str::from_utf8(&bytes).map_err(|_| invalid("笔记不是有效 UTF-8"))?,
            );
            let links: Vec<SourceLink> =
                match self.files.read_optional(&format!("{base}.links.json"))? {
                    Some(bytes) => decode(&bytes)?,
                    None => Vec::new(),
                };
            let mut resources = Vec::new();
            let mut refs = BTreeSet::from([entity("entry", entry.id.as_str())]);
            let mut link_ids = BTreeSet::new();
            self.markdown_assets(
                entry.id.as_str(),
                Some(note_id.as_str()),
                markdown,
                &mut resources,
            )?;
            for link in &links {
                if link.owner
                    != (LinkOwner::Note {
                        entry_id: entry.id.clone(),
                        note_id: note_id.clone(),
                    })
                    || !link_ids.insert(link.link_id.to_string())
                {
                    return Err(invalid("笔记来源链接归属错误或标识重复"));
                }
                for source in &link.sources {
                    id(source.entry_id.as_str())?;
                    refs.insert(entity("entry", source.entry_id.as_str()));
                    // Cross-entry references remain explicit; no title-based merges
                    // or replacement segment IDs are invented by export.
                    if !source
                        .segment_uid
                        .as_str()
                        .starts_with(crate::pdf_text::PDF_TEXT_PREFIX)
                    {
                        refs.insert(entity("parse", source.entry_id.as_str()));
                    }
                    if let Some(bbox) = source.bbox {
                        references::validate_bbox(bbox)?;
                    }
                    self.parse_asset(
                        source.entry_id.as_str(),
                        source.snapshot_asset_path.as_deref(),
                        &mut resources,
                    )?;
                    self.markdown_assets(
                        source.entry_id.as_str(),
                        None,
                        &source.snapshot_text,
                        &mut resources,
                    )?;
                }
            }
            // Body and source links are a single content-addressed resource and
            // therefore one version/conflict, including notes larger than 2 MiB.
            let note = json!({"note_id":note_id,"title":title,"markdown":markdown,"links":links});
            resources.push(self.files.generated(
                "note.json",
                serde_json::to_vec(&note).map_err(io::Error::other)?,
            ));
            self.document(
                entity("note", note_id.as_str()),
                ObjectKind::Note,
                json!({"entry_id":entry.id,"note_id":note_id,"content_resource":"note.json"}),
                resources,
                refs.into_iter().collect(),
            )?;
        }
        Ok(())
    }

    pub(super) fn segment_notes(&mut self, entry_id: &str) -> io::Result<()> {
        let notes: Vec<neuink_domain::SegmentBlockNote> = self
            .files
            .read_optional(&format!("entries/{entry_id}/segment-notes.json"))?
            .map(|b| decode(&b))
            .transpose()?
            .unwrap_or_default();
        for note in notes {
            if note.segment_uid.as_str().is_empty() {
                return Err(invalid("片段笔记标识为空"));
            }
            let mut resources = Vec::new();
            self.markdown_assets(entry_id, None, &note.text, &mut resources)?;
            let mut refs = vec![entity("entry", entry_id)];
            if !note
                .segment_uid
                .as_str()
                .starts_with(crate::pdf_text::PDF_TEXT_PREFIX)
            {
                refs.push(entity("parse", entry_id));
            }
            self.document(
                format!("segment_note:{entry_id}:{}", note.segment_uid),
                ObjectKind::SegmentNote,
                json!({"entry_id":entry_id,"note":note}),
                resources,
                refs,
            )?;
        }
        Ok(())
    }

    pub(super) fn annotations(&mut self, entry_id: &str) -> io::Result<()> {
        let bytes = self
            .files
            .read_optional(&format!("entries/{entry_id}/paper.annotations.json"))?;
        let annotations: Vec<Annotation> =
            bytes.map(|b| decode(&b)).transpose()?.unwrap_or_default();
        for annotation in annotations {
            id(annotation.annotation_id.as_str())?;
            let mut resources = Vec::new();
            if let Some(selection) = &annotation.text_selection {
                selection
                    .validate()
                    .map_err(|_| invalid("批注文字选区无效"))?;
            }
            if let Some(snapshot) = &annotation.segment_snapshot {
                if let Some(bbox) = snapshot.bbox {
                    references::validate_bbox(bbox)?;
                }
                self.parse_asset(entry_id, snapshot.asset_path.as_deref(), &mut resources)?;
                self.markdown_assets(entry_id, None, &snapshot.text, &mut resources)?;
                if let Some(markdown) = &snapshot.markdown {
                    self.markdown_assets(entry_id, None, markdown, &mut resources)?;
                }
            }
            let mut refs = vec![entity("entry", entry_id)];
            if annotation.anchor_kind == neuink_domain::AnnotationAnchorKind::Segment {
                refs.push(entity("parse", entry_id));
            }
            self.document(
                entity("annotation", annotation.annotation_id.as_str()),
                ObjectKind::Annotation,
                json!({"entry_id":entry_id,"annotation":annotation}),
                resources,
                refs,
            )?;
        }
        Ok(())
    }
}
