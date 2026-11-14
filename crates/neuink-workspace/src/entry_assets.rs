//! Visual assets copied out of a MinerU client ZIP.
//!
//! What was missing before this module: the parser already records
//! [`neuink_domain::SourceSegment::asset_path`] (the ZIP-relative `images/...` path
//! taken from `content_list`), but nothing ever wrote the image bytes — the ZIP's
//! `images/` folder was only checked for existence. A visual retrieval channel
//! therefore had no readable figure to encode.
//!
//! Stored layout: `<entry>/assets/images/<name>`, i.e. the ZIP-relative path is
//! preserved, so resolving a segment asset is
//! `entry_assets_dir(entry).join(asset_path)` with no path translation.
//!
//! Writes are staged in a sibling directory and published with one rename; the
//! manifest beside the directory lets an identical re-import be recognised without
//! reading every image again.

use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use neuink_domain::EntryId;
use serde::{Deserialize, Serialize};
use zip::ZipArchive;

use crate::{atomic_write_json, Workspace, WorkspaceError};

/// Largest single asset accepted. MinerU crops are far smaller; this only stops a
/// hostile or malformed archive from filling the disk.
pub const MAX_ASSET_FILE_BYTES: u64 = 32 * 1024 * 1024;
/// Budget for all assets of one entry.
pub const MAX_ASSET_TOTAL_BYTES: u64 = 512 * 1024 * 1024;
/// Formats the image crate can later decode for encoding.
pub const ASSET_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "webp"];

const MANIFEST_VERSION: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntryAssetImport {
    pub asset_count: usize,
    pub total_bytes: u64,
    /// True when the stored bytes already matched the ZIP, so nothing was rewritten.
    pub reused: bool,
}

/// One stored asset, as the retrieval index needs to see it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntryAsset {
    /// ZIP-relative path, identical to the segment's `asset_path`.
    pub relative_path: String,
    pub content_hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct AssetManifest {
    version: u32,
    files: BTreeMap<String, String>,
    total_bytes: u64,
}

/// Maps a ZIP entry name to the asset path that is stored, or `None` for entries
/// that are not images.
///
/// Absolute names, drive letters, `..` and empty components are rejected rather
/// than skipped: inside an `images` tree they can only be an attempt to write
/// outside the entry.
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
    let mut components = replaced.split('/').filter(|component| !component.is_empty());
    let Some(images_at) = replaced.split('/').position(|component| component == "images") else {
        return Ok(None);
    };
    let relative = components
        .by_ref()
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

fn is_symlink(file: &zip::read::ZipFile<'_>) -> bool {
    // 0o120000 is S_IFLNK in the ZIP external-attributes unix mode.
    file.unix_mode()
        .is_some_and(|mode| mode & 0o170000 == 0o120000)
}

fn staging_dir(entry_dir: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    entry_dir.join(format!("assets.new-{}-{nanos}", std::process::id()))
}

fn write_staging(staging: &Path, staged: &[(String, Vec<u8>)]) -> Result<(), WorkspaceError> {
    for (relative, bytes) in staged {
        let path = staging.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, bytes)?;
    }
    Ok(())
}

/// Replaces the asset directory with the staged one, restoring the previous
/// directory if the final rename fails.
fn publish_assets(entry_dir: &Path, staging: &Path, assets_dir: &Path) -> Result<(), WorkspaceError> {
    let backup = entry_dir.join(format!("assets.old-{}", std::process::id()));
    let had_existing = assets_dir.is_dir();
    if had_existing {
        let _ = fs::remove_dir_all(&backup);
        fs::rename(assets_dir, &backup)?;
    }
    match fs::rename(staging, assets_dir) {
        Ok(()) => {
            if had_existing {
                let _ = fs::remove_dir_all(&backup);
            }
            Ok(())
        }
        Err(error) => {
            if had_existing {
                let _ = fs::rename(&backup, assets_dir);
            }
            Err(error.into())
        }
    }
}

impl Workspace {
    /// Copies every image under an `images` component of the ZIP into the entry's
    /// asset directory. A ZIP without images imports zero assets and creates no
    /// directory.
    ///
    /// Validation happens before anything is written, so a rejected archive never
    /// leaves a half-published asset directory behind.
    pub fn import_entry_assets_from_zip(
        &self,
        entry_id: &EntryId,
        zip_bytes: &[u8],
    ) -> Result<EntryAssetImport, WorkspaceError> {
        let entry_dir = self.layout().entry_dir(entry_id);
        if !entry_dir.is_dir() {
            return Err(WorkspaceError::EntryMissing(entry_id.to_string()));
        }
        let mut archive = ZipArchive::new(Cursor::new(zip_bytes))?;
        let mut staged: Vec<(String, Vec<u8>)> = Vec::new();
        let mut total_bytes = 0u64;
        for index in 0..archive.len() {
            let mut file = archive.by_index(index)?;
            if file.is_dir() {
                continue;
            }
            let Some(relative) = asset_relative_path(file.name())? else {
                continue;
            };
            if is_symlink(&file) {
                return Err(WorkspaceError::AssetSymlink(relative));
            }
            if !ASSET_EXTENSIONS.contains(&extension_of(&relative).as_str()) {
                // A stray non-image inside `images/` is not something the visual
                // channel can encode, and it must not block the parse import.
                continue;
            }
            if file.size() > MAX_ASSET_FILE_BYTES {
                return Err(WorkspaceError::AssetFileTooLarge(relative));
            }
            // The declared size can lie, so the read itself is bounded too.
            let mut bytes = Vec::new();
            (&mut file)
                .take(MAX_ASSET_FILE_BYTES + 1)
                .read_to_end(&mut bytes)?;
            if bytes.len() as u64 > MAX_ASSET_FILE_BYTES {
                return Err(WorkspaceError::AssetFileTooLarge(relative));
            }
            total_bytes = total_bytes
                .checked_add(bytes.len() as u64)
                .ok_or_else(|| WorkspaceError::AssetBudgetExceeded(relative.clone()))?;
            if total_bytes > MAX_ASSET_TOTAL_BYTES {
                return Err(WorkspaceError::AssetBudgetExceeded(relative));
            }
            staged.push((relative, bytes));
        }
        if staged.is_empty() {
            return Ok(EntryAssetImport {
                asset_count: 0,
                total_bytes: 0,
                reused: false,
            });
        }

        let manifest = AssetManifest {
            version: MANIFEST_VERSION,
            files: staged
                .iter()
                .map(|(relative, bytes)| (relative.clone(), blake3::hash(bytes).to_hex().to_string()))
                .collect(),
            total_bytes,
        };
        let assets_dir = self.layout().entry_assets_dir(entry_id);
        let manifest_path = self.layout().entry_assets_manifest_file(entry_id);
        if assets_dir.is_dir() && stored_manifest(&manifest_path).as_ref() == Some(&manifest) {
            return Ok(EntryAssetImport {
                asset_count: staged.len(),
                total_bytes,
                reused: true,
            });
        }

        let staging = staging_dir(&entry_dir);
        if let Err(error) = write_staging(&staging, &staged) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        if let Err(error) = publish_assets(&entry_dir, &staging, &assets_dir) {
            let _ = fs::remove_dir_all(&staging);
            return Err(error);
        }
        atomic_write_json(&manifest_path, &manifest)?;
        Ok(EntryAssetImport {
            asset_count: staged.len(),
            total_bytes,
            reused: false,
        })
    }

    /// Bytes of one stored asset, resolved by the segment's `asset_path`.
    pub fn entry_asset_bytes(
        &self,
        entry_id: &EntryId,
        asset_path: &str,
    ) -> Result<Vec<u8>, WorkspaceError> {
        let relative = asset_relative_path(asset_path)?
            .ok_or_else(|| WorkspaceError::AssetMissing(asset_path.to_string()))?;
        let path = self.layout().entry_assets_dir(entry_id).join(&relative);
        if !path.is_file() {
            return Err(WorkspaceError::AssetMissing(relative));
        }
        Ok(fs::read(path)?)
    }

    /// Stored assets of one entry with their content hashes, in path order.
    pub fn entry_assets(&self, entry_id: &EntryId) -> Result<Vec<EntryAsset>, WorkspaceError> {
        let manifest_path = self.layout().entry_assets_manifest_file(entry_id);
        let Some(manifest) = stored_manifest(&manifest_path) else {
            return Ok(Vec::new());
        };
        Ok(manifest
            .files
            .into_iter()
            .map(|(relative_path, content_hash)| EntryAsset {
                relative_path,
                content_hash,
            })
            .collect())
    }
}

/// One stored asset with the segment facts the visual index needs.
///
/// `page_idx` and `segment_type` come from the first segment whose `asset_path`
/// matches. An asset with no matching segment keeps `None`: the file exists even when
/// the current parse no longer references it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EntryVisualAsset {
    pub entry_id: String,
    pub relative_path: String,
    pub page_idx: Option<u32>,
    pub segment_type: Option<neuink_domain::SegmentType>,
    pub content_hash: String,
}

impl Workspace {
    /// Assets of the entries a visual index should cover.
    ///
    /// `scope`: `None` means every live entry; `Some(ids)` means only those, and an
    /// unknown id is an error rather than silently ignored, so a caller can neither
    /// widen nor quietly narrow the set.
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
            let assets = self.entry_assets(&entry.id)?;
            if assets.is_empty() {
                continue;
            }
            let anchors = self
                .read_segments(&entry.id)
                .map(|segments| {
                    segments
                        .into_iter()
                        .filter_map(|segment| {
                            segment
                                .asset_path
                                .clone()
                                .map(|path| (path, (segment.page_idx, segment.segment_type)))
                        })
                        .collect::<std::collections::BTreeMap<_, _>>()
                })
                .unwrap_or_default();
            for asset in assets {
                let anchor = anchors.get(&asset.relative_path).copied();
                collected.push(EntryVisualAsset {
                    entry_id: entry.id.to_string(),
                    relative_path: asset.relative_path,
                    page_idx: anchor.map(|(page_idx, _)| page_idx),
                    segment_type: anchor.map(|(_, kind)| kind),
                    content_hash: asset.content_hash,
                });
            }
        }
        Ok(collected)
    }
}

fn stored_manifest(path: &Path) -> Option<AssetManifest> {
    let bytes = fs::read(path).ok()?;
    let manifest = serde_json::from_slice::<AssetManifest>(&bytes).ok()?;
    (manifest.version == MANIFEST_VERSION).then_some(manifest)
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use zip::{write::SimpleFileOptions, ZipWriter};

    use super::{
        asset_relative_path, ASSET_EXTENSIONS, MAX_ASSET_FILE_BYTES,
    };
    use crate::Workspace;

    fn zip_with(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in entries {
            writer
                .start_file(*name, SimpleFileOptions::default())
                .expect("start zip entry");
            writer.write_all(bytes).expect("write zip entry");
        }
        writer.finish().expect("finish zip").into_inner()
    }

    fn workspace_with_entry() -> (tempfile::TempDir, crate::Workspace, neuink_domain::EntryId) {
        let root = tempfile::tempdir().expect("temp workspace");
        let workspace = Workspace::create(root.path()).expect("create workspace");
        let entry = workspace.create_entry("Paper").expect("create entry");
        (root, workspace, entry.id)
    }

    #[test]
    fn imports_images_and_preserves_the_zip_relative_path() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        let png = b"\x89PNG\r\n\x1a\nfake";
        let zip = zip_with(&[
            ("paper/images/fig1.jpg", b"figure-one"),
            ("paper/images/table1.png", png),
            ("paper/paper_content_list.json", b"[]"),
        ]);
        let import = workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect("import assets");
        assert_eq!(import.asset_count, 2);
        assert!(!import.reused);
        assert_eq!(
            workspace
                .entry_asset_bytes(&entry_id, "images/fig1.jpg")
                .expect("read asset"),
            b"figure-one"
        );
        let assets = workspace.entry_assets(&entry_id).expect("list assets");
        assert_eq!(
            assets
                .iter()
                .map(|asset| asset.relative_path.as_str())
                .collect::<Vec<_>>(),
            ["images/fig1.jpg", "images/table1.png"]
        );
        assert!(assets.iter().all(|asset| asset.content_hash.len() == 64));
    }

    #[test]
    fn a_second_import_of_the_same_zip_reuses_the_stored_bytes() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        let zip = zip_with(&[("paper/images/fig1.jpg", b"figure-one")]);
        assert!(!workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect("first import")
            .reused);
        assert!(workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect("second import")
            .reused);
    }

    #[test]
    fn a_changed_asset_replaces_the_directory() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        workspace
            .import_entry_assets_from_zip(&entry_id, &zip_with(&[("images/fig1.jpg", b"one")]))
            .expect("first import");
        let import = workspace
            .import_entry_assets_from_zip(&entry_id, &zip_with(&[
                ("images/fig1.jpg", b"two"),
                ("images/fig2.jpg", b"new"),
            ]))
            .expect("second import");
        assert!(!import.reused);
        assert_eq!(import.asset_count, 2);
        assert_eq!(
            workspace
                .entry_asset_bytes(&entry_id, "images/fig1.jpg")
                .expect("read asset"),
            b"two"
        );
    }

    #[test]
    fn path_traversal_is_rejected_before_anything_is_written() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        let zip = zip_with(&[("images/../../escape.jpg", b"nope")]);
        let error = workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect_err("traversal must fail");
        assert!(matches!(
            error,
            crate::WorkspaceError::AssetPathTraversal(_)
        ));
        assert!(!workspace.layout().entry_assets_dir(&entry_id).exists());
    }

    #[test]
    fn a_zip_with_only_unsupported_files_imports_nothing() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        let zip = zip_with(&[("images/payload.exe", b"binary")]);
        let import = workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect("import skips non-images");
        assert_eq!(import.asset_count, 0);
        assert!(!workspace.layout().entry_assets_dir(&entry_id).exists());
    }

    #[test]
    fn a_stray_non_image_inside_images_is_skipped_not_fatal() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        let zip = zip_with(&[
            ("images/fig1.jpg", b"figure-one"),
            ("images/notes.svg", b"<svg/>"),
            ("images/layout.json", b"{}"),
        ]);
        let import = workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect("import");
        assert_eq!(import.asset_count, 1);
        assert_eq!(
            workspace
                .entry_assets(&entry_id)
                .expect("list")
                .iter()
                .map(|asset| asset.relative_path.as_str())
                .collect::<Vec<_>>(),
            ["images/fig1.jpg"]
        );
    }

    #[test]
    fn an_oversized_asset_is_rejected_from_the_declared_size() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        let oversized = vec![0u8; (MAX_ASSET_FILE_BYTES + 1) as usize];
        let zip = zip_with(&[("images/huge.png", oversized.as_slice())]);
        let error = workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect_err("size must fail");
        assert!(matches!(
            error,
            crate::WorkspaceError::AssetFileTooLarge(_)
        ));
    }

    #[test]
    fn a_zip_without_images_imports_nothing_and_creates_no_directory() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        let zip = zip_with(&[("paper/paper_content_list.json", b"[]")]);
        let import = workspace
            .import_entry_assets_from_zip(&entry_id, &zip)
            .expect("import");
        assert_eq!(import.asset_count, 0);
        assert!(!workspace.layout().entry_assets_dir(&entry_id).exists());
        assert!(workspace.entry_assets(&entry_id).expect("list").is_empty());
    }

    #[test]
    fn collected_visual_assets_carry_the_segment_page_and_kind() {
        use neuink_domain::{SegmentType, SourceSegment};

        let (_root, workspace, entry_id) = workspace_with_entry();
        workspace
            .import_entry_assets_from_zip(
                &entry_id,
                &zip_with(&[
                    ("images/fig1.jpg", b"figure-one"),
                    ("images/orphan.jpg", b"no-segment"),
                ]),
            )
            .expect("import");
        workspace
            .write_segments(
                &entry_id,
                &[SourceSegment::new(SegmentType::Figure, 4, None, "a figure".to_string())
                    .with_asset_path(Some("images/fig1.jpg".to_string()))],
            )
            .expect("write segments");

        let collected = workspace
            .collect_entry_visual_assets(None)
            .expect("collect assets");
        assert_eq!(collected.len(), 2);
        let figure = collected
            .iter()
            .find(|asset| asset.relative_path == "images/fig1.jpg")
            .expect("figure asset");
        assert_eq!(figure.page_idx, Some(4));
        assert_eq!(figure.segment_type, Some(SegmentType::Figure));
        let orphan = collected
            .iter()
            .find(|asset| asset.relative_path == "images/orphan.jpg")
            .expect("orphan asset");
        // A stored file with no referencing segment keeps its bytes and no anchor.
        assert_eq!(orphan.page_idx, None);
        assert_eq!(orphan.segment_type, None);
    }

    #[test]
    fn an_unknown_scope_entry_is_rejected_instead_of_widening_the_set() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        workspace
            .import_entry_assets_from_zip(&entry_id, &zip_with(&[("images/a.jpg", b"a")]))
            .expect("import");
        let error = workspace
            .collect_entry_visual_assets(Some(&[neuink_domain::EntryId::from_string("nope")]))
            .expect_err("unknown scope must fail");
        assert!(matches!(
            error,
            crate::WorkspaceError::VisualScopeUnknownEntry(_)
        ));
    }

    #[test]
    fn a_missing_asset_is_reported_rather_than_read_from_elsewhere() {
        let (_root, workspace, entry_id) = workspace_with_entry();
        workspace
            .import_entry_assets_from_zip(&entry_id, &zip_with(&[("images/fig1.jpg", b"one")]))
            .expect("import");
        let error = workspace
            .entry_asset_bytes(&entry_id, "images/missing.jpg")
            .expect_err("missing asset must fail");
        assert!(matches!(error, crate::WorkspaceError::AssetMissing(_)));
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
        assert_eq!(
            asset_relative_path("images/").expect("ok"),
            None
        );
        assert!(asset_relative_path("/images/a.jpg").is_err());
        assert!(asset_relative_path("C:/images/a.jpg").is_err());
        assert_eq!(ASSET_EXTENSIONS.len(), 4);
    }
}
