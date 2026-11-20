use super::*;
use neuink_domain::{Annotation, SourceSegment};
use neuink_domain::{
    AnnotationImportance, NoteId, PdfAsset, PdfParseState, SegmentRef, SegmentType, SourceLink,
};
use std::{fs, path::PathBuf};

pub(super) struct Fixture {
    pub(super) dir: tempfile::TempDir,
    pub(super) entry: EntryMeta,
    pub(super) note_id: NoteId,
    pub(super) segment: SourceSegment,
    pub(super) annotation: Annotation,
    pub(super) link: SourceLink,
}

pub(super) fn write(root: &Path, relative: &str, bytes: impl AsRef<[u8]>) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

impl Fixture {
    pub(super) fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let mut entry = EntryMeta::new("Test paper").unwrap();
        let note_id = NoteId::new();
        entry.contents.push(ContentItem::Note {
            note_id: note_id.clone(),
            title: "Note".into(),
        });
        entry.pdf = Some(PdfAsset {
            file_name: "D:\\private\\paper.pdf".into(),
            content_hash: "legacy hash".into(),
            imported_at: entry.created_at,
            parse: PdfParseState {
                status: PdfParseStatus::Parsing,
                updated_at: entry.updated_at,
                message: Some("private log".into()),
                task_id: Some("secret task".into()),
                endpoint: Some("https://parser.invalid/?key=secret".into()),
            },
        });
        let mut segment = SourceSegment::new(
            SegmentType::Figure,
            2,
            Some([1., 2., 30., 40.]),
            "Figure ![result](images/result.png)".into(),
        );
        segment.asset_path = Some("images/result.png".into());
        segment
            .mineru_metadata
            .insert("private_provider_config".into(), "private_key".into());
        let annotation = Annotation::new_for_segment(
            &segment,
            "comment",
            "Check this",
            AnnotationImportance::Normal,
        );
        let link = SourceLink::note(
            entry.id.clone(),
            note_id.clone(),
            "source1".into(),
            SegmentRef {
                entry_id: entry.id.clone(),
                segment_uid: segment.uid.clone(),
                page: 2,
                bbox: segment.bbox,
                segment_type: Some(segment.segment_type),
                snapshot_text: "Figure".into(),
                snapshot_asset_path: segment.asset_path.clone(),
                quote_hash: "quote".into(),
            },
            "Evidence".into(),
        );
        let fixture = Self {
            dir,
            entry,
            note_id,
            segment,
            annotation,
            link,
        };
        fixture.save();
        fixture
    }
    pub(super) fn path(&self, relative: &str) -> PathBuf {
        self.dir
            .path()
            .join(format!("entries/{}/{relative}", self.entry.id))
    }
    pub(super) fn save(&self) {
        let base = format!("entries/{}", self.entry.id);
        for (name, value) in [
            ("entry.meta.json", json!(self.entry)),
            ("paper.segments.json", json!([self.segment])),
            ("paper.annotations.json", json!([self.annotation])),
        ] {
            write(
                self.dir.path(),
                &format!("{base}/{name}"),
                serde_json::to_vec(&value).unwrap(),
            );
        }
        // An actual lossless image and small PDF fixture, shared between note and parse paths.
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        write(
            self.dir.path(),
            &format!("{base}/mineru-output/images/result.png"),
            png.get_ref(),
        );
        write(
            self.dir.path(),
            &format!("{base}/notes/{}.assets/figure.png", self.note_id),
            png.get_ref(),
        );
        write(
            self.dir.path(),
            &format!("{base}/paper.pdf"),
            b"%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF",
        );
        write(
            self.dir.path(),
            &format!("{base}/notes/{}.md", self.note_id),
            format!(
                "---\nid: {}\n---\n\nMy note [^source1]\n![figure](./{}.assets/figure.png)",
                self.note_id, self.note_id
            ),
        );
        write(
            self.dir.path(),
            &format!("{base}/notes/{}.links.json", self.note_id),
            serde_json::to_vec(&vec![self.link.clone()]).unwrap(),
        );
        write(
            self.dir.path(),
            &format!("{base}/mineru-output/full.zip"),
            b"original recovery material",
        );
        write(self.dir.path(), "settings.json", b"never upload this key");
        write(
            self.dir.path(),
            "conversations/private.json",
            b"chat history",
        );
    }
    pub(super) fn export(&self) -> ExportBundle {
        export_entry(self.dir.path(), self.entry.id.as_str()).unwrap()
    }
}

pub(super) fn content(bundle: &ExportBundle, document: &EntityDocument, name: &str) -> Value {
    let resource = document.resources.iter().find(|r| r.name == name).unwrap();
    serde_json::from_slice(&bundle.attachment_bytes(&resource.hash).unwrap()).unwrap()
}
