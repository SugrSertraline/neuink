//! Explicitly scoped repair for pre-fix imports; ordinary test runs never touch a library.
use super::*;
use neuink_domain::{EntryId, NoteId};
use neuink_workspace::Workspace;
use note_images::{save_image, SaveSciverseNoteImageRequest};
use std::{fs, path::PathBuf};

#[tokio::test]
#[ignore = "Manual repair ONLY: requires explicit root, entry, note, source doc_id and backup directory"]
async fn repair_requested_note_images() {
    let root =
        PathBuf::from(std::env::var("NEUINK_IMAGE_REPAIR_ROOT").expect("explicit root required"));
    let entry_id: EntryId = serde_json::from_value(serde_json::json!(std::env::var(
        "NEUINK_IMAGE_REPAIR_ENTRY"
    )
    .unwrap()))
    .unwrap();
    let note_id: NoteId = serde_json::from_value(serde_json::json!(std::env::var(
        "NEUINK_IMAGE_REPAIR_NOTE"
    )
    .unwrap()))
    .unwrap();
    let doc_id = std::env::var("NEUINK_SCIVERSE_TEST_DOC_ID").unwrap();
    let backup = PathBuf::from(
        std::env::var("NEUINK_IMAGE_REPAIR_BACKUP").expect("explicit backup directory required"),
    );
    let workspace = Workspace::open_existing(&root).unwrap();
    let entry = workspace.read_entry(&entry_id).unwrap();
    assert_eq!(entry.fields["Sciverse 文档 ID"], doc_id);
    let before = workspace.read_note(&entry_id, &note_id).unwrap();
    assert!(before
        .markdown
        .contains(&format!("Sciverse 文档 ID: {doc_id}")));
    let token = env_token()
        .or_else(|| read_credential().ok().flatten())
        .expect("configured credential required");
    let client = SciverseClient::new(DEFAULT_SCIVERSE_BASE_URL, token).unwrap();
    let source = client
        .content(&ContentRequest {
            doc_id,
            offset: None,
            limit: None,
        })
        .await
        .unwrap();
    assert!(!source.more, "repair requires the complete source");
    let mut references = Vec::new();
    for line in source.text.lines() {
        if let Some(reference) = line
            .trim()
            .strip_prefix("![](")
            .and_then(|value| value.strip_suffix(')'))
        {
            if !references.contains(&reference.to_string()) {
                references.push(reference.to_string());
            }
        }
    }
    assert!(!references.is_empty());
    let placeholder = |index: usize| format!("[图片 {} 未能保存到本地]", index + 1);
    let mut expected = source.text.clone();
    for (index, reference) in references.iter().enumerate() {
        expected = expected.replace(&format!("![]({reference})"), &placeholder(index));
        assert!(
            before.markdown.contains(&placeholder(index)),
            "this repair only applies to the original all-failed import"
        );
    }
    let summary = format!(
        "\n\n> 以下远程图片未能离线保存，在线引用已移除：\n{}{}\n",
        (1..=references.len().min(5))
            .map(|i| format!("- 图片 {i} 未能保存到本地。"))
            .collect::<Vec<_>>()
            .join("\n"),
        if references.len() > 5 {
            format!("\n- 另有 {} 张图片未能保存。", references.len() - 5)
        } else {
            String::new()
        }
    );
    let mut without_summary = before
        .markdown
        .strip_suffix(&summary)
        .expect("original failure summary must match")
        .to_string();
    // The old paginated API sometimes expands an image but advances within its
    // original URL. Remove only a matching filename suffix immediately after
    // that image; the full-source comparison below must still match exactly.
    for (index, reference) in references.iter().enumerate() {
        let marker = placeholder(index);
        let start = without_summary.find(&marker).unwrap() + marker.len();
        let rest = &without_summary[start..];
        let tail = rest.trim_start().lines().next().unwrap_or("");
        if let Some(suffix) = tail.strip_suffix(')') {
            if suffix.len() >= 16
                && reference.ends_with(suffix)
                && suffix
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.')
            {
                let end = start + rest.len() - rest.trim_start().len() + tail.len();
                without_summary.replace_range(start..end, "");
            }
        }
    }
    let body = without_summary.split_once("## 远程全文\n\n").unwrap().1;
    let normalize = |value: &str| {
        value
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
    };
    assert!(
        normalize(body) == normalize(&expected),
        "source content changed; stop instead of guessing image positions"
    );

    // Keep recoverable snapshots before any changes. Refuse to overwrite an earlier backup.
    fs::create_dir(&backup).expect("use a fresh backup directory");
    fs::copy(
        workspace.layout().entry_note_file(&entry_id, &note_id),
        backup.join("note.md"),
    )
    .unwrap();
    fs::copy(
        workspace
            .layout()
            .entry_note_links_file(&entry_id, &note_id),
        backup.join("note.links.json"),
    )
    .unwrap();
    fs::copy(
        workspace.layout().entry_meta_file(&entry_id),
        backup.join("entry.meta.json"),
    )
    .unwrap();
    let mut repaired = without_summary;
    for (index, reference) in references.iter().enumerate() {
        let saved = save_image(
            &client,
            DEFAULT_SCIVERSE_BASE_URL,
            SaveSciverseNoteImageRequest {
                root: root.clone(),
                entry_id: entry_id.clone(),
                note_id: note_id.clone(),
                reference: reference.clone(),
            },
        )
        .await
        .unwrap_or_else(|_| {
            panic!(
                "image {} could not be saved; original note is unchanged",
                index + 1
            )
        });
        repaired = repaired.replace(
            &placeholder(index),
            &format!("![]({})", saved.markdown_path),
        );
        println!("image {} saved locally", index + 1);
    }
    let after = workspace
        .update_note_if_revision(
            &entry_id,
            &note_id,
            &before.title,
            &repaired,
            Some(&before.revision),
        )
        .unwrap();
    assert_eq!(after.markdown.trim_start(), repaired.trim_start());
    assert_eq!(after.links, before.links);
    let current_entry = workspace.read_entry(&entry_id).unwrap();
    assert_eq!(current_entry.fields, entry.fields);
    assert_eq!(current_entry.pdf, entry.pdf);
    assert_eq!(current_entry.contents, entry.contents);
    println!(
        "repaired {} image references; note text, links and entry metadata preserved",
        references.len()
    );
}
