use std::{fs, io::ErrorKind};

use chrono::Utc;
use neuink_domain::{EntryId, EntryMeta, PdfParseStatus, SegmentType, SourceSegment};
use serde::{Deserialize, Serialize};

use crate::{atomic_write_json, Workspace, WorkspaceError};

#[derive(Debug, Serialize)]
pub struct TitleConsistency {
    pub entry_title: String,
    pub pdf_file_name: String,
    pub evidence: Vec<String>,
    pub source_revision: String,
    pub confirmed: bool,
}

#[derive(Deserialize, Serialize)]
struct TitleReviewConfirmation {
    entry_title: String,
    pdf_file_name: String,
    source_revision: String,
    confirmed_at: chrono::DateTime<Utc>,
}

impl Workspace {
    pub fn inspect_title_consistency(
        &self,
        entry_id: &EntryId,
    ) -> Result<Option<TitleConsistency>, WorkspaceError> {
        let entry = self.read_entry(entry_id)?;
        let Some(pdf) = entry.pdf.as_ref() else {
            return Ok(None);
        };
        if pdf.parse.status != PdfParseStatus::Succeeded {
            return Ok(None);
        }
        let segments = self.read_segments(entry_id)?;
        let evidence = title_evidence(&segments);
        let source_revision = blake3::hash(&serde_json::to_vec(&segments)?)
            .to_hex()
            .to_string();
        let confirmation = match fs::read(self.title_review_confirmation_file(entry_id)) {
            Ok(bytes) => serde_json::from_slice::<TitleReviewConfirmation>(&bytes).ok(),
            Err(error) if error.kind() == ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let confirmed = confirmation.is_some_and(|saved| {
            saved.entry_title == entry.title
                && saved.pdf_file_name == pdf.file_name
                && saved.source_revision == source_revision
        });
        Ok(Some(TitleConsistency {
            entry_title: entry.title,
            pdf_file_name: pdf.file_name.clone(),
            evidence,
            source_revision,
            confirmed,
        }))
    }

    pub fn confirm_title_consistency(
        &self,
        entry_id: &EntryId,
        expected_title: &str,
        expected_pdf_file_name: &str,
        expected_source_revision: &str,
    ) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let current = self
            .inspect_title_consistency(entry_id)?
            .ok_or_else(|| WorkspaceError::EntryRevisionConflict(entry_id.to_string()))?;
        if current.entry_title != expected_title
            || current.pdf_file_name != expected_pdf_file_name
            || current.source_revision != expected_source_revision
        {
            return Err(WorkspaceError::EntryRevisionConflict(entry_id.to_string()));
        }
        atomic_write_json(
            self.title_review_confirmation_file(entry_id),
            &TitleReviewConfirmation {
                entry_title: current.entry_title,
                pdf_file_name: current.pdf_file_name,
                source_revision: current.source_revision,
                confirmed_at: Utc::now(),
            },
        )
    }

    fn title_review_confirmation_file(&self, entry_id: &EntryId) -> std::path::PathBuf {
        self.layout()
            .entry_dir(entry_id)
            .join("title-review-confirmation.json")
    }

    pub fn apply_title_consistency(
        &self,
        entry_id: &EntryId,
        expected_title: &str,
        expected_pdf_file_name: &str,
        expected_source_revision: &str,
        suggested_title: &str,
        update_entry_title: bool,
        update_pdf_file_name: bool,
    ) -> Result<EntryMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let current = self
            .inspect_title_consistency(entry_id)?
            .ok_or_else(|| WorkspaceError::EntryRevisionConflict(entry_id.to_string()))?;
        if current.entry_title != expected_title
            || current.pdf_file_name != expected_pdf_file_name
            || current.source_revision != expected_source_revision
        {
            return Err(WorkspaceError::EntryRevisionConflict(entry_id.to_string()));
        }
        let suggested_title = suggested_title.trim();
        let source_key = title_key(&current.evidence.join(" "));
        let suggested_key = title_key(suggested_title);
        if suggested_key.chars().count() < 6
            || suggested_title.chars().count() > 220
            || !source_key.contains(&suggested_key)
            || !(update_entry_title || update_pdf_file_name)
        {
            return Err(WorkspaceError::EntryRevisionConflict(entry_id.to_string()));
        }
        let mut entry = self.read_entry(entry_id)?;
        if update_entry_title {
            entry.title = suggested_title.to_string();
        }
        if update_pdf_file_name {
            let pdf = entry
                .pdf
                .as_mut()
                .ok_or_else(|| WorkspaceError::PdfMissing(entry_id.to_string()))?;
            pdf.file_name = suggested_pdf_name(suggested_title);
        }
        entry.updated_at = Utc::now();
        entry.validate()?;
        atomic_write_json(self.layout().entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }
}

fn title_evidence(segments: &[SourceSegment]) -> Vec<String> {
    segments
        .iter()
        .filter(|segment| {
            segment.page_idx == 0
                && matches!(
                    segment.segment_type,
                    SegmentType::Heading | SegmentType::Paragraph | SegmentType::AsideText
                )
        })
        .take(24)
        .filter_map(|segment| {
            let text = segment
                .text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ");
            (!text.is_empty()).then(|| text.chars().take(450).collect::<String>())
        })
        .scan(0usize, |total, text| {
            *total += text.chars().count();
            (*total <= 6000).then_some(text)
        })
        .collect()
}

fn suggested_pdf_name(title: &str) -> String {
    let stem = safe_file_stem(title);
    if stem.is_empty() {
        String::new()
    } else {
        format!("{stem}.pdf")
    }
}

fn title_key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn safe_file_stem(title: &str) -> String {
    let stem: String = title
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .take(150)
        .collect();
    stem.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches('.')
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn includes_front_page_headings_and_text() {
        let segments = vec![
            SourceSegment::new(
                SegmentType::Heading,
                0,
                None,
                "A Long Research Paper Title".into(),
            ),
            SourceSegment::new(
                SegmentType::Heading,
                1,
                None,
                "Different Section Heading".into(),
            ),
        ];
        assert_eq!(
            title_evidence(&segments),
            vec!["A Long Research Paper Title"]
        );
    }

    #[test]
    fn normalizes_title_and_sanitizes_display_name() {
        assert_eq!(
            title_key("A: Paper — Title"),
            title_key("a paper title.pdf".trim_end_matches(".pdf"))
        );
        assert_eq!(safe_file_stem("A: Paper / Title"), "A Paper Title");
    }

    #[test]
    fn inspects_and_applies_selected_fields_without_overwriting_other_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let mut entry = workspace.create_entry("Upload name").unwrap();
        entry.fields.insert("DOI".into(), "10.1000/test".into());
        atomic_write_json(workspace.layout().entry_meta_file(&entry.id), &entry).unwrap();
        let pdf_path = dir.path().join("upload.pdf");
        std::fs::write(&pdf_path, b"%PDF-1.4\n").unwrap();
        entry = workspace.import_pdf(&entry.id, &pdf_path).unwrap();
        entry.pdf.as_mut().unwrap().parse.status = PdfParseStatus::Succeeded;
        atomic_write_json(workspace.layout().entry_meta_file(&entry.id), &entry).unwrap();
        workspace
            .write_segments(
                &entry.id,
                &[SourceSegment::new(
                    SegmentType::Heading,
                    0,
                    None,
                    "A Reliable Paper Title".into(),
                )],
            )
            .unwrap();

        let inspection = workspace
            .inspect_title_consistency(&entry.id)
            .unwrap()
            .unwrap();
        assert_eq!(inspection.entry_title, "Upload name");
        assert!(!inspection.confirmed);
        assert!(!inspection.source_revision.is_empty());
        assert_eq!(inspection.evidence, vec!["A Reliable Paper Title"]);
        assert!(workspace
            .apply_title_consistency(
                &entry.id,
                &inspection.entry_title,
                &inspection.pdf_file_name,
                &inspection.source_revision,
                "Invented Paper Title",
                true,
                true
            )
            .is_err());
        let updated = workspace
            .apply_title_consistency(
                &entry.id,
                &inspection.entry_title,
                &inspection.pdf_file_name,
                &inspection.source_revision,
                "A Reliable Paper Title",
                true,
                false,
            )
            .unwrap();
        assert_eq!(updated.title, "A Reliable Paper Title");
        assert_eq!(updated.pdf.as_ref().unwrap().file_name, "upload.pdf");
        assert_eq!(updated.fields.get("DOI").unwrap(), "10.1000/test");
        let remaining = workspace
            .inspect_title_consistency(&entry.id)
            .unwrap()
            .unwrap();
        assert_eq!(remaining.entry_title, "A Reliable Paper Title");
        assert!(workspace
            .apply_title_consistency(
                &entry.id,
                &inspection.entry_title,
                &inspection.pdf_file_name,
                &inspection.source_revision,
                "A Reliable Paper Title",
                false,
                true
            )
            .is_err());
        let corrected = workspace
            .apply_title_consistency(
                &entry.id,
                &remaining.entry_title,
                &remaining.pdf_file_name,
                &remaining.source_revision,
                "A Reliable Paper Title",
                false,
                true,
            )
            .unwrap();
        assert_eq!(
            corrected.pdf.as_ref().unwrap().file_name,
            "A Reliable Paper Title.pdf"
        );
        let done = workspace
            .inspect_title_consistency(&entry.id)
            .unwrap()
            .unwrap();
        assert_eq!(done.pdf_file_name, "A Reliable Paper Title.pdf");
        assert!(workspace
            .confirm_title_consistency(
                &entry.id,
                &inspection.entry_title,
                &inspection.pdf_file_name,
                &inspection.source_revision,
            )
            .is_err());
        workspace
            .confirm_title_consistency(
                &entry.id,
                &done.entry_title,
                &done.pdf_file_name,
                &done.source_revision,
            )
            .unwrap();
        let reopened = Workspace::open(dir.path()).unwrap();
        assert!(
            reopened
                .inspect_title_consistency(&entry.id)
                .unwrap()
                .unwrap()
                .confirmed
        );
        workspace
            .write_segments(
                &entry.id,
                &[SourceSegment::new(
                    SegmentType::Heading,
                    0,
                    None,
                    "A Different Paper Title".into(),
                )],
            )
            .unwrap();
        assert!(
            !workspace
                .inspect_title_consistency(&entry.id)
                .unwrap()
                .unwrap()
                .confirmed
        );
        assert!(workspace
            .apply_title_consistency(
                &entry.id,
                &done.entry_title,
                &done.pdf_file_name,
                &done.source_revision,
                "A Reliable Paper Title",
                true,
                true
            )
            .is_err());
    }

    #[test]
    fn missing_first_page_evidence_still_requires_confirmation() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = Workspace::create(dir.path()).unwrap();
        let mut entry = workspace.create_entry("Upload name").unwrap();
        let pdf_path = dir.path().join("upload.pdf");
        fs::write(&pdf_path, b"%PDF-1.4\n").unwrap();
        entry = workspace.import_pdf(&entry.id, &pdf_path).unwrap();
        entry.pdf.as_mut().unwrap().parse.status = PdfParseStatus::Succeeded;
        atomic_write_json(workspace.layout().entry_meta_file(&entry.id), &entry).unwrap();
        workspace.write_segments(&entry.id, &[]).unwrap();
        let inspection = workspace
            .inspect_title_consistency(&entry.id)
            .unwrap()
            .unwrap();
        assert!(inspection.evidence.is_empty());
        assert!(!inspection.confirmed);
        workspace
            .confirm_title_consistency(
                &entry.id,
                &inspection.entry_title,
                &inspection.pdf_file_name,
                &inspection.source_revision,
            )
            .unwrap();
        assert!(
            workspace
                .inspect_title_consistency(&entry.id)
                .unwrap()
                .unwrap()
                .confirmed
        );
        entry.title = "Renamed entry".into();
        atomic_write_json(workspace.layout().entry_meta_file(&entry.id), &entry).unwrap();
        let renamed = workspace
            .inspect_title_consistency(&entry.id)
            .unwrap()
            .unwrap();
        assert!(!renamed.confirmed);
        workspace
            .confirm_title_consistency(
                &entry.id,
                &renamed.entry_title,
                &renamed.pdf_file_name,
                &renamed.source_revision,
            )
            .unwrap();
        entry.pdf.as_mut().unwrap().file_name = "renamed.pdf".into();
        atomic_write_json(workspace.layout().entry_meta_file(&entry.id), &entry).unwrap();
        assert!(
            !workspace
                .inspect_title_consistency(&entry.id)
                .unwrap()
                .unwrap()
                .confirmed
        );
    }
}
