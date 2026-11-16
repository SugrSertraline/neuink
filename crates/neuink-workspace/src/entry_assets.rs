//! Visual assets read straight from the MinerU ZIP the entry already stores.
//!
//! Why no separate copy: a parsed entry keeps `<entry>/mineru-output/full.zip`, and that
//! archive already holds the `images/**` bytes the parse referenced. Persisting a second
//! copy under `assets/` doubled the disk cost, added a whole write path (zip-slip checks,
//! staging directory, atomic swap, a manifest) and forced a migration command for libraries
//! imported before that copy existed. Reading from the ZIP instead means old and new
//! libraries behave the same and nothing has to be migrated.
//!
//! Resolution rule: `SourceSegment::asset_path` is the ZIP-relative `images/...` path, so a
//! stored asset is looked up by exactly that name.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

use neuink_domain::{EntryId, SegmentType, SourceSegment};
use zip::ZipArchive;

use crate::{Workspace, WorkspaceError};

/// Largest single image accepted. MinerU crops are far smaller; this only stops a
/// malformed archive from exhausting memory while hashing or encoding.
pub const MAX_ASSET_FILE_BYTES: u64 = 32 * 1024 * 1024;
/// Formats the image encoder can decode.
pub const ASSET_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

/// One stored asset with the facts the visual index needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntryVisualAsset {
    pub entry_id: String,
    /// ZIP-relative path, identical to the segment's `asset_path`.
    pub relative_path: String,
    pub page_idx: Option<u32>,
    pub segment_type: Option<SegmentType>,
    /// Content hash of the bytes, so a changed image re-embeds.
    pub content_hash: String,
}

/// Maps a ZIP entry name to the asset path this module exposes, or `None` for entries that
/// are not images. Absolute names, drive letters and `..` are rejected rather than skipped:
/// inside an `images` tree they can only be an attempt to resolve outside it.
fn asset_relative_path(raw: &str) -> Result<Option<String>, WorkspaceError> {
    let replaced = raw.replace('\\', "/");
    let looks_absolute = replaced.starts_with('/')
        || replaced
            .as_bytes()
            .get(1)
            .is_some_and(|byte| *byte == b':');
    if looks_absolute {
        return Err(WorkspaceError::AssetPathTraversal(raw.to_string()));
    }
    if replaced.split('/').any(|component| component == "..") {
        return Err(WorkspaceError::AssetPathTraversal(raw.to_string()));
    }
    let Some(images_at) = replaced.split('/').position(|component| component == "images") else {
        return Ok(None);
    };
    let relative = replaced
        .split('/')
        .filter(|component| !component.is_empty())
        .skip(images_at)
        .collect::<Vec<_>>()
        .join("/");
    if relative.is_empty() || relative == "images" {
        return Ok(None);
    }
    Ok(Some(relative))
}

fn extension_of(relative: &str) -> String {
    Path::new(relative)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn segment_anchors(segments: &[SourceSegment]) -> BTreeMap<String, (u32, SegmentType)> {
    let mut anchors = BTreeMap::new();
    for segment in segments {
        let Some(path) = segment.asset_path.as_ref() else {
            continue;
        };
        anchors
            .entry(path.clone())
            .or_insert((segment.page_idx, segment.segment_type));
    }
    anchors
}

impl Workspace {
    /// Image assets of the entries a visual index should cover.
    ///
    /// `scope`: `None` means every live entry; `Some(ids)` means only those, and an unknown
    /// id is an error rather than silently ignored, so a caller can neither widen nor
    /// quietly narrow the set.
    pub fn collect_entry_visual_assets(
        &self,
        scope: Option<&[EntryId]>,
    ) -> Result<Vec<EntryVisualAsset>, WorkspaceError> {
        let mut entries = self.list_entries()?;
        entries.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| left.id.as_str().cmp(right.id.as_str()))
        });
        if let Some(requested) = scope {
            let requested = requested
                .iter()
                .map(EntryId::as_str)
                .collect::<std::collections::BTreeSet<_>>();
            let live = entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<std::collections::BTreeSet<_>>();
            for id in &requested {
                if !live.contains(id) {
                    return Err(WorkspaceError::VisualScopeUnknownEntry(id.to_string()));
                }
            }
            entries.retain(|entry| requested.contains(entry.id.as_str()));
        }

        let mut collected = Vec::new();
        for entry in entries {
            let zip_path = self.layout().entry_mineru_output_zip(&entry.id);
            if !zip_path.is_file() {
                continue;
            }
            let anchors = self
                .read_segments(&entry.id)
                .map(|segments| segment_anchors(&segments))
                .unwrap_or_default();
            for (relative_path, content_hash) in stored_images(&zip_path)? {
                let anchor = anchors.get(&relative_path).copied();
                collected.push(EntryVisualAsset {
                    entry_id: entry.id.to_string(),
                    relative_path,
                    page_idx: anchor.map(|(page_idx, _)| page_idx),
                    segment_type: anchor.map(|(_, kind)| kind),
                    content_hash,
                });
            }
        }
        Ok(collected)
    }

    /// Bytes of one stored asset, read from the entry's MinerU ZIP.
    pub fn entry_asset_bytes(
        &self,
        entry_id: &EntryId,
        asset_path: &str,
    ) -> Result<Vec<u8>, WorkspaceError> {
        let relative = asset_relative_path(asset_path)?
            .ok_or_else(|| WorkspaceError::AssetMissing(asset_path.to_string()))?;
        let zip_path = self.layout().entry_mineru_output_zip(entry_id);
        if !zip_path.is_file() {
            return Err(WorkspaceError::AssetMissing(relative));
        }
        let mut archive = open_archive(&zip_path)?;
        for index in 0..archive.len() {
            let file = archive.by_index(index)?;
            if file.is_dir() {
                continue;
            }
            let Ok(Some(name)) = asset_relative_path(file.name()) else {
                continue;
            };
            if name != relative {
                continue;
            }
            return read_bounded(file, &relative);
        }
        Err(WorkspaceError::AssetMissing(relative))
    }
}

/// Every image in the archive with its content hash, in path order.
fn stored_images(zip_path: &Path) -> Result<Vec<(String, String)>, WorkspaceError> {
    let mut archive = open_archive(zip_path)?;
    let mut images = Vec::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        if file.is_dir() {
            continue;
        }
        let name = match asset_relative_path(file.name()) {
            Ok(Some(name)) => name,
            // The archive is read only, so a hostile or non-image name is skipped: one bad
            // entry must not fail the whole library.
            Ok(None) | Err(_) => continue,
        };
        if !ASSET_EXTENSIONS.contains(&extension_of(&name).as_str()) {
            continue;
        }
        if file.size() > MAX_ASSET_FILE_BYTES {
            continue;
        }
        let bytes = read_bounded(file, &name)?;
        images.push((name, blake3::hash(&bytes).to_hex().to_string()));
    }
    images.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(images)
}

fn open_archive(zip_path: &Path) -> Result<ZipArchive<File>, WorkspaceError> {
    let file = File::open(zip_path)?;
    Ok(ZipArchive::new(file)?)
}

/// The declared size can lie, so the read itself is bounded.
fn read_bounded(mut file: zip::read::ZipFile<'_>, name: &str) -> Result<Vec<u8>, WorkspaceError> {
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_ASSET_FILE_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_ASSET_FILE_BYTES {
        return Err(WorkspaceError::AssetFileTooLarge(name.to_string()));
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use neuink_domain::{EntryId, SegmentType, SourceSegment};
    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::{asset_relative_path, MAX_ASSET_FILE_BYTES};
    use crate::Workspace;

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        writer
            .start_file("paper_content_list.json", SimpleFileOptions::default())
            .expect("json entry");
        writer.write_all(b"[]").expect("json bytes");
        for (name, bytes) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("start entry");
            writer.write_all(bytes).expect("write entry");
        }
        writer.finish().expect("finish zip").into_inner()
    }

    fn workspace_with_zip(zip: &[u8]) -> (tempfile::TempDir, Workspace, EntryId) {
        let root = tempfile::tempdir().expect("temp workspace");
        let workspace = Workspace::create(root.path()).expect("create workspace");
        let entry = workspace.create_entry("Paper").expect("create entry");
        workspace
            .write_mineru_output_zip(&entry.id, zip)
            .expect("store zip");
        (root, workspace, entry.id)
    }

    #[test]
    fn collects_images_from_the_stored_zip_and_maps_segment_anchors() {
        let zip = zip_with(&[
            ("paper/images/fig1.jpg", b"figure-one"),
            ("paper/images/table1.png", b"table-one"),
        ]);
        let (_root, workspace, entry_id) = workspace_with_zip(&zip);
        workspace
            .write_segments(
                &entry_id,
                &[SourceSegment::new(SegmentType::Figure, 4, None, "a figure".to_string())
                    .with_asset_path(Some("images/fig1.jpg".to_string()))],
            )
            .expect("segments");

        let collected = workspace.collect_entry_visual_assets(None).expect("collect");
        assert_eq!(collected.len(), 2);
        let figure = collected
            .iter()
            .find(|asset| asset.relative_path == "images/fig1.jpg")
            .expect("figure asset");
        assert_eq!(figure.page_idx, Some(4));
        assert_eq!(figure.segment_type, Some(SegmentType::Figure));
        assert_eq!(figure.content_hash.len(), 64);
        // An image with no referencing segment keeps no anchor but is still listed.
        let table = collected
            .iter()
            .find(|asset| asset.relative_path == "images/table1.png")
            .expect("table asset");
        assert_eq!(table.page_idx, None);
    }

    #[test]
    fn asset_bytes_are_read_back_from_the_zip() {
        let (_root, workspace, entry_id) = workspace_with_zip(&zip_with(&[("images/a.jpg", b"bytes-here")]));
        assert_eq!(
            workspace
                .entry_asset_bytes(&entry_id, "images/a.jpg")
                .expect("read"),
            b"bytes-here"
        );
        assert!(matches!(
            workspace.entry_asset_bytes(&entry_id, "images/missing.jpg"),
            Err(crate::WorkspaceError::AssetMissing(_))
        ));
    }

    #[test]
    fn an_entry_without_a_stored_zip_contributes_nothing() {
        let root = tempfile::tempdir().expect("temp workspace");
        let workspace = Workspace::create(root.path()).expect("create workspace");
        workspace.create_entry("No parse").expect("create entry");
        assert!(workspace
            .collect_entry_visual_assets(None)
            .expect("collect")
            .is_empty());
    }

    #[test]
    fn non_images_and_hostile_names_are_skipped_without_failing_the_library() {
        let zip = zip_with(&[
            ("images/fig1.jpg", b"ok"),
            ("images/notes.txt", b"text"),
            ("images/../../escape.jpg", b"nope"),
        ]);
        let (_root, workspace, _entry_id) = workspace_with_zip(&zip);
        let collected = workspace.collect_entry_visual_assets(None).expect("collect");
        assert_eq!(
            collected
                .iter()
                .map(|asset| asset.relative_path.as_str())
                .collect::<Vec<_>>(),
            ["images/fig1.jpg"]
        );
    }

    #[test]
    fn an_oversized_image_is_skipped() {
        let oversized = vec![0u8; (MAX_ASSET_FILE_BYTES + 1) as usize];
        let zip = zip_with(&[("images/huge.png", oversized.as_slice()), ("images/ok.jpg", b"ok")]);
        let (_root, workspace, _entry_id) = workspace_with_zip(&zip);
        let collected = workspace.collect_entry_visual_assets(None).expect("collect");
        assert_eq!(
            collected
                .iter()
                .map(|asset| asset.relative_path.as_str())
                .collect::<Vec<_>>(),
            ["images/ok.jpg"]
        );
    }

    #[test]
    fn an_unknown_scope_entry_is_rejected_instead_of_widening_the_set() {
        let (_root, workspace, _entry_id) = workspace_with_zip(&zip_with(&[("images/a.jpg", b"a")]));
        assert!(matches!(
            workspace
                .collect_entry_visual_assets(Some(&[EntryId::from_string("nope")])),
            Err(crate::WorkspaceError::VisualScopeUnknownEntry(_))
        ));
    }

    #[test]
    fn asset_paths_are_mapped_only_under_an_images_component() {
        assert_eq!(
            asset_relative_path("paper/images/a.jpg").expect("ok"),
            Some("images/a.jpg".to_string())
        );
        assert_eq!(
            asset_relative_path("paper/paper_content_list.json").expect("ok"),
            None
        );
        assert!(asset_relative_path("/images/a.jpg").is_err());
        assert!(asset_relative_path("C:/images/a.jpg").is_err());
        assert!(asset_relative_path("images/../../a.jpg").is_err());
    }
}

