use super::super::*;
use crate::{
    EntryTranslation, TranslatedSegment, TranslatedSegmentStatus, TranslationProgress,
    TranslationStatus, Workspace,
};
use chrono::Utc;
use neuink_domain::{EntryId, SegmentType, SourceSegment};
use std::{
    fs,
    io::{Cursor, Read},
    path::PathBuf,
};

pub(super) struct Fixture {
    pub(super) base: PathBuf,
    pub(super) workspace: Workspace,
    pub(super) id: EntryId,
}

impl Fixture {
    pub(super) fn new(segments: &[SourceSegment]) -> Self {
        let base = std::env::temp_dir().join(format!("neuink-export-test-{}", EntryId::new()));
        let workspace = Workspace::create(base.join("workspace")).unwrap();
        let id = workspace
            .create_entry("有机合成研究 Research paper")
            .unwrap()
            .id;
        workspace.write_segments(&id, segments).unwrap();
        Self {
            base,
            workspace,
            id,
        }
    }

    pub(super) fn translations(&self, records: Vec<TranslatedSegment>) {
        self.workspace
            .write_entry_translation(
                &self.id,
                &EntryTranslation {
                    schema_version: 1,
                    entry_id: self.id.clone(),
                    source_language: "en".into(),
                    target_language: "zh-CN".into(),
                    status: TranslationStatus::Partial,
                    progress: TranslationProgress {
                        total: records.len(),
                        translated: 0,
                        skipped: 0,
                        failed: 0,
                    },
                    paper_context: None,
                    segments: records,
                    model: None,
                    error: None,
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                },
            )
            .unwrap();
    }

    pub(super) fn inspect(&self, kind: PaperExportKind) -> PaperExportInspection {
        inspect_paper_export(
            &self.workspace,
            &self.id,
            kind,
            &PaperExportOptions::default(),
        )
        .unwrap()
    }

    pub(super) fn image(&self, path: &str) {
        let image = image::RgbaImage::from_fn(320, 80, |x, _| {
            if x < 160 {
                image::Rgba([40, 80, 120, 255])
            } else {
                image::Rgba([200, 220, 240, 255])
            }
        });
        let path = self
            .workspace
            .layout()
            .entry_mineru_output_dir(&self.id)
            .join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        image.save(path).unwrap();
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.base);
    }
}

pub(super) fn segment(kind: SegmentType, text: &str) -> SourceSegment {
    SourceSegment::new(kind, 0, None, text.into())
}

pub(super) fn translated(segment: &SourceSegment, text: &str) -> TranslatedSegment {
    TranslatedSegment {
        segment_uid: segment.uid.clone(),
        page_idx: segment.page_idx,
        segment_type: segment.segment_type,
        source_hash: translation_source_hash(source_text(segment)),
        source_text: source_text(segment).into(),
        translated_text: Some(text.into()),
        status: TranslatedSegmentStatus::Translated,
        error: None,
        updated_at: Utc::now(),
    }
}

pub(super) fn zip_text(bytes: &[u8], name: &str) -> String {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut text = String::new();
    archive
        .by_name(name)
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    text
}

pub(super) fn representative_fixture() -> Fixture {
    let heading = segment(SegmentType::Heading, "## Organic synthesis");
    let paragraph = segment(
        SegmentType::Paragraph,
        "A mathematical model predicts the reaction yield. The conditions are given below.",
    );
    let table = segment(SegmentType::Table, "<table><tr><th>Catalyst</th><th>Temperature</th><th>Yield</th></tr><tr><td>A</td><td>25 °C</td><td>85%</td></tr><tr><td>B</td><td>40 °C</td><td>92%</td></tr></table>");
    let math = segment(SegmentType::Math, "$$E=mc^2$$");
    let figure = segment(SegmentType::Figure, "![Two regions](images/diagram.png)");
    let footnote = segment(
        SegmentType::PageFootnote,
        "Footnote: values are illustrative.",
    );
    let fixture = Fixture::new(&[
        heading.clone(),
        paragraph.clone(),
        table.clone(),
        math,
        figure,
        footnote.clone(),
    ]);
    fixture.translations(vec![translated(&heading, "## 有机合成"), translated(&paragraph, "数学模型预测反应产率。反应条件列于下表。"),
        translated(&table, "| 催化剂 | 温度 | 产率 |\n| --- | --- | --- |\n| A | 25 °C | 85% |\n| B | 40 °C | 92% |"),
        translated(&footnote, "脚注：数值仅用于示例。")]);
    fixture.image("images/diagram.png");
    fixture
}
