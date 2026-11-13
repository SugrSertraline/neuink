use neuink_domain::{
    AnnotationImportance, ContentItem, EntryId, NoteId, PdfParseStatus, SegmentType, SourceSegment,
};
use neuink_workspace::Workspace;

pub struct Paper {
    pub entry_id: EntryId,
    pub notes: Vec<NoteId>,
    pub segment: SourceSegment,
    pub pdf: Vec<u8>,
    pub png: Vec<u8>,
}

fn pdf(marker: &str) -> Vec<u8> {
    // Valid one-page PDF, with an inert comment large enough to cross a chunk boundary.
    let content = format!("%{marker}{}\nq Q\n", "x".repeat(4 * 1024 * 1024));
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>"
            .into(),
        format!(
            "<< /Length {} >>\nstream\n{content}endstream",
            content.len()
        ),
    ];
    let mut out = b"%PDF-1.4\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
    }
    let xref = out.len();
    out.extend_from_slice(b"xref\n0 5\n0000000000 65535 f \n");
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!("trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n").as_bytes(),
    );
    out
}

pub fn paper(workspace: &Workspace) -> Paper {
    let entry = workspace.create_entry("Roundtrip paper").unwrap();
    let pdf = pdf(entry.id.as_str());
    workspace
        .import_pdf_bytes(&entry.id, "fixture.pdf", &pdf)
        .unwrap();
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(3, 2)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let path = workspace
        .layout()
        .entry_mineru_output_dir(&entry.id)
        .join("images");
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(path.join("figure.png"), png.get_ref()).unwrap();
    let segment = SourceSegment::new(
        SegmentType::Figure,
        0,
        Some([10., 20., 100., 80.]),
        "Figure".into(),
    )
    .with_asset_path(Some("images/figure.png".into()));
    workspace
        .write_segments(&entry.id, &[segment.clone()])
        .unwrap();
    for status in [
        PdfParseStatus::Queued,
        PdfParseStatus::Uploading,
        PdfParseStatus::Uploaded,
        PdfParseStatus::Parsing,
        PdfParseStatus::Succeeded,
    ] {
        workspace
            .set_pdf_parse_state(&entry.id, status, None)
            .unwrap();
    }
    workspace
        .create_annotation(
            &entry.id,
            segment.uid.clone(),
            "comment".into(),
            "Evidence".into(),
            AnnotationImportance::Important,
        )
        .unwrap();
    let mut notes = Vec::new();
    for index in 0..5 {
        let updated = workspace
            .create_note(&entry.id, format!("Note {index}"))
            .unwrap();
        let ContentItem::Note { note_id, .. } = updated.contents.last().unwrap();
        let link = workspace
            .create_note_source_link(&entry.id, note_id, &entry.id, segment.uid.clone())
            .unwrap();
        workspace
            .update_note(
                &entry.id,
                note_id,
                format!("Note {index}"),
                format!("Evidence {index} [^{}]", link.anchor_id),
            )
            .unwrap();
        notes.push(note_id.clone());
    }
    Paper {
        entry_id: entry.id,
        notes,
        segment,
        pdf,
        png: png.into_inner(),
    }
}
