use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

use chrono::Utc;
use neuink_domain::{
    ContentItem, EntryId, EntryMeta, LinkOwner, NoteId, SegmentRef, SegmentUid, SourceLink,
    SourceSegment,
};
use serde::{Deserialize, Serialize};

use crate::{atomic_write, atomic_write_json, Workspace, WorkspaceError};

const NOTE_ASSET_ORPHAN_GRACE_SECONDS: i64 = 7 * 24 * 60 * 60;
const NOTE_ASSET_ORPHAN_MANIFEST: &str = ".orphaned-assets.json";
const NOTE_ASSET_ORPHAN_DIR: &str = ".orphaned";

#[derive(Debug, Default, Deserialize, Serialize)]
struct NoteAssetOrphanManifest {
    #[serde(default)]
    unreferenced_since: BTreeMap<String, i64>,
}

#[derive(Debug)]
struct NoteAssetTransaction {
    manifest_path: PathBuf,
    moves: Vec<(PathBuf, PathBuf)>,
    previous_manifest: Option<Vec<u8>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NoteDocument {
    pub note_id: NoteId,
    pub title: String,
    pub markdown: String,
    pub links: Vec<SourceLink>,
    pub revision: String,
}

impl Workspace {
    pub fn read_note(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<NoteDocument, WorkspaceError> {
        let entry = self.read_entry(entry_id)?;
        let title = entry
            .contents
            .iter()
            .find_map(|content| match content {
                ContentItem::Note {
                    note_id: content_note_id,
                    title,
                } if content_note_id == note_id => Some(title.clone()),
                _ => None,
            })
            .ok_or_else(|| WorkspaceError::NoteMissing(note_id.to_string()))?;

        let note_path = self.layout().entry_note_file(entry_id, note_id);
        if !note_path.exists() {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }

        let note_source = fs::read_to_string(note_path)?;
        let markdown = strip_frontmatter(&note_source).to_string();
        let mut links = self.read_note_links(entry_id, note_id)?;
        let revision = note_revision(&note_source, &links)?;
        self.enrich_note_source_link_assets(&mut links);
        Ok(NoteDocument {
            note_id: note_id.clone(),
            title,
            markdown,
            links,
            revision,
        })
    }

    pub fn update_note(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        title: impl Into<String>,
        markdown: impl Into<String>,
    ) -> Result<NoteDocument, WorkspaceError> {
        self.update_note_if_revision(entry_id, note_id, title, markdown, None)
    }

    pub fn update_note_if_revision(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        title: impl Into<String>,
        markdown: impl Into<String>,
        expected_revision: Option<&str>,
    ) -> Result<NoteDocument, WorkspaceError> {
        self.update_note_document(
            entry_id,
            note_id,
            title.into(),
            markdown.into(),
            None,
            expected_revision,
        )
    }

    pub fn update_note_document_if_revision(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        title: impl Into<String>,
        markdown: impl Into<String>,
        links: &[SourceLink],
        expected_revision: Option<&str>,
    ) -> Result<NoteDocument, WorkspaceError> {
        self.update_note_document(
            entry_id,
            note_id,
            title.into(),
            markdown.into(),
            Some(links),
            expected_revision,
        )
    }

    fn update_note_document(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        title: String,
        markdown: String,
        replacement_links: Option<&[SourceLink]>,
        expected_revision: Option<&str>,
    ) -> Result<NoteDocument, WorkspaceError> {
        let title = normalize_note_title(title.into());
        // Same lock order as delete/restore, and recover before taking a snapshot.
        let _metadata_guard = self.begin_tag_safe_mutation()?;
        let note_path = self.layout().entry_note_file(entry_id, note_id);
        let write_lock = note_write_lock(&note_path);
        let _write_guard = write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !note_path.exists() {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }
        let previous_note = fs::read_to_string(&note_path)?;
        let previous_links = self.read_note_links(entry_id, note_id)?;
        if let Some(expected_revision) = expected_revision {
            let current_revision = note_revision(&previous_note, &previous_links)?;
            if current_revision != expected_revision {
                return Err(WorkspaceError::NoteRevisionConflict(note_id.to_string()));
            }
        }
        let links = match replacement_links {
            Some(links) => validate_and_prune_note_links(entry_id, note_id, &markdown, links)?,
            None => prune_note_links(&markdown, &previous_links),
        };
        let mut entry = self.read_entry(entry_id)?;
        let mut note_found = false;

        for content in &mut entry.contents {
            let ContentItem::Note {
                note_id: content_note_id,
                title: content_title,
            } = content;
            if content_note_id == note_id {
                *content_title = title.clone();
                note_found = true;
            }
        }

        if !note_found {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }

        let frontmatter_title = title.replace('\\', "\\\\").replace('"', "\\\"");
        let body = format!(
            "---\nkind: note\nentry_id: {}\nnote_id: {}\ntitle: \"{}\"\nupdated_at: \"{}\"\n---\n\n{}",
            entry_id.as_str(),
            note_id.as_str(),
            frontmatter_title,
            Utc::now().to_rfc3339(),
            markdown.trim_start()
        );
        entry.updated_at = Utc::now();
        use crate::content_transaction::ContentTarget;
        let changes = vec![
            self.content_change(
                ContentTarget::NoteBody {
                    entry_id: entry_id.clone(),
                    note_id: note_id.clone(),
                },
                body.into_bytes(),
            )?,
            self.content_change(
                ContentTarget::NoteLinks {
                    entry_id: entry_id.clone(),
                    note_id: note_id.clone(),
                },
                serde_json::to_vec_pretty(&links)?,
            )?,
            self.content_change(
                ContentTarget::EntryMeta {
                    entry_id: entry_id.clone(),
                },
                serde_json::to_vec_pretty(&entry)?,
            )?,
        ];
        self.commit_content_transaction(changes)?;
        drop(_write_guard);
        self.read_note(entry_id, note_id)
    }

    pub fn delete_note(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<EntryMeta, WorkspaceError> {
        let _metadata_guard = self.begin_tag_safe_mutation()?;
        let entry = self.read_entry(entry_id)?;
        let (original_index, title) = entry
            .contents
            .iter()
            .enumerate()
            .find_map(|(index, content)| match content {
                ContentItem::Note {
                    note_id: current,
                    title,
                } if current == note_id => Some((index, title.clone())),
                _ => None,
            })
            .ok_or_else(|| WorkspaceError::NoteMissing(note_id.to_string()))?;
        self.store_deleted_markdown_note(entry_id, note_id, title, original_index)?;
        self.read_entry(entry_id)
    }

    pub fn create_note_source_link(
        &self,
        owner_entry_id: &EntryId,
        note_id: &NoteId,
        source_entry_id: &EntryId,
        segment_uid: SegmentUid,
    ) -> Result<SourceLink, WorkspaceError> {
        let _metadata_guard = self.begin_tag_safe_mutation()?;
        let link =
            self.build_note_source_link(owner_entry_id, note_id, source_entry_id, segment_uid)?;

        let note_path = self.layout().entry_note_file(owner_entry_id, note_id);
        let write_lock = note_write_lock(&note_path);
        let _write_guard = write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !note_path.exists() {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }
        let mut links = self.read_note_links(owner_entry_id, note_id)?;
        links.push(link.clone());
        let change = self.content_change(
            crate::content_transaction::ContentTarget::NoteLinks {
                entry_id: owner_entry_id.clone(),
                note_id: note_id.clone(),
            },
            serde_json::to_vec_pretty(&links)?,
        )?;
        self.commit_content_transaction(vec![change])?;
        Ok(link)
    }

    pub fn build_note_source_link(
        &self,
        owner_entry_id: &EntryId,
        note_id: &NoteId,
        source_entry_id: &EntryId,
        segment_uid: SegmentUid,
    ) -> Result<SourceLink, WorkspaceError> {
        self.read_note(owner_entry_id, note_id)?;
        self.build_owned_source_link(
            LinkOwner::Note {
                entry_id: owner_entry_id.clone(),
                note_id: note_id.clone(),
            },
            source_entry_id,
            segment_uid,
        )
    }

    pub(crate) fn build_owned_source_link(
        &self,
        owner: LinkOwner,
        source_entry_id: &EntryId,
        segment_uid: SegmentUid,
    ) -> Result<SourceLink, WorkspaceError> {
        crate::tag_reading::validate_id(source_entry_id.as_str())?;
        let source_entry = self.read_entry(source_entry_id)?;
        // Existing parsed segments remain valid while a reparse is queued or has failed.
        let segment = self.resolve_source_segment(source_entry_id, &segment_uid)?;
        let source_segment_uid = segment.uid.clone();
        let snapshot_text = segment
            .markdown
            .as_ref()
            .filter(|markdown| !markdown.trim().is_empty())
            .cloned()
            .unwrap_or_else(|| segment.text.clone());
        let anchor_id = format!("sl-{}", neuink_domain::SourceLinkId::new().as_str());
        let source = SegmentRef {
            entry_id: source_entry_id.clone(),
            segment_uid: source_segment_uid,
            page: segment.page_idx + 1,
            bbox: segment.bbox,
            segment_type: Some(segment.segment_type),
            quote_hash: blake3::hash(snapshot_text.as_bytes()).to_hex().to_string(),
            snapshot_asset_path: segment.asset_path.clone(),
            snapshot_text,
        };
        Ok(SourceLink {
            link_id: neuink_domain::SourceLinkId::new(),
            anchor_id,
            owner,
            sources: vec![source],
            display_text: format!("{} · p.{}", source_entry.title, segment.page_idx + 1),
            created_at: Utc::now(),
        })
    }

    pub fn read_note_source_links(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<Vec<SourceLink>, WorkspaceError> {
        self.read_note(entry_id, note_id)?;
        self.read_note_links(entry_id, note_id)
    }

    pub fn replace_note_source_links(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        links: &[SourceLink],
    ) -> Result<(), WorkspaceError> {
        let _metadata_guard = self.begin_tag_safe_mutation()?;
        let note_path = self.layout().entry_note_file(entry_id, note_id);
        let write_lock = note_write_lock(&note_path);
        let _write_guard = write_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !note_path.exists() {
            return Err(WorkspaceError::NoteMissing(note_id.to_string()));
        }
        let note_source = fs::read_to_string(&note_path)?;
        let links = validate_and_prune_note_links(
            entry_id,
            note_id,
            strip_frontmatter(&note_source),
            links,
        )?;
        let change = self.content_change(
            crate::content_transaction::ContentTarget::NoteLinks {
                entry_id: entry_id.clone(),
                note_id: note_id.clone(),
            },
            serde_json::to_vec_pretty(&links)?,
        )?;
        self.commit_content_transaction(vec![change])
    }

    fn read_note_links(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
    ) -> Result<Vec<SourceLink>, WorkspaceError> {
        let path = self.layout().entry_note_links_file(entry_id, note_id);
        if !path.exists() {
            return Ok(Vec::new());
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    pub(crate) fn prepare_content_note_assets(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        body: &[u8],
    ) -> Result<(), WorkspaceError> {
        let body = std::str::from_utf8(body)
            .map_err(|_| WorkspaceError::InvalidNoteDocument("note body must be UTF-8".into()))?;
        // Called only after durable intent exists. Replay can restore an image
        // again without moving it out of a newly recovered note.
        self.prepare_note_asset_maintenance(entry_id, note_id, strip_frontmatter(body))?;
        Ok(())
    }

    fn prepare_note_asset_maintenance(
        &self,
        entry_id: &EntryId,
        note_id: &NoteId,
        markdown: &str,
    ) -> Result<Option<NoteAssetTransaction>, WorkspaceError> {
        let asset_dir = self.layout().entry_note_assets_dir(entry_id, note_id);
        self.validate_note_workspace_path(&asset_dir)?;
        if !asset_dir.exists() {
            return Ok(None);
        }

        let manifest_path = asset_dir.join(NOTE_ASSET_ORPHAN_MANIFEST);
        self.validate_note_workspace_path(&manifest_path)?;
        let previous_manifest = if manifest_path.exists() {
            Some(fs::read(&manifest_path)?)
        } else {
            None
        };
        let mut manifest = match previous_manifest.as_deref() {
            Some(bytes) => serde_json::from_slice(bytes)?,
            None => NoteAssetOrphanManifest::default(),
        };
        let referenced = referenced_note_asset_names(markdown, note_id);
        let quarantine_dir = asset_dir.join(NOTE_ASSET_ORPHAN_DIR);
        self.validate_note_workspace_path(&quarantine_dir)?;
        let mut transaction = NoteAssetTransaction {
            manifest_path: manifest_path.clone(),
            moves: Vec::new(),
            previous_manifest,
        };

        let maintenance_result = (|| -> Result<(), WorkspaceError> {
            for file_name in &referenced {
                let active_path = asset_dir.join(file_name);
                let quarantined_path = quarantine_dir.join(file_name);
                self.validate_note_workspace_path(&active_path)?;
                self.validate_note_workspace_path(&quarantined_path)?;
                if !active_path.exists() && quarantined_path.is_file() {
                    fs::rename(&quarantined_path, &active_path)?;
                    transaction.moves.push((quarantined_path, active_path));
                }
                manifest.unreferenced_since.remove(file_name);
            }

            let now = Utc::now().timestamp();
            for entry in fs::read_dir(&asset_dir)? {
                let path = entry?.path();
                self.validate_note_workspace_path(&path)?;
                if !path.is_file() {
                    continue;
                }
                let Some(file_name) = path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .map(str::to_string)
                else {
                    continue;
                };
                if !is_managed_note_asset_name(&file_name) {
                    continue;
                }
                if referenced.contains(&file_name) {
                    manifest.unreferenced_since.remove(&file_name);
                    continue;
                }

                let first_seen = *manifest
                    .unreferenced_since
                    .entry(file_name.clone())
                    .or_insert(now);
                if now.saturating_sub(first_seen) < NOTE_ASSET_ORPHAN_GRACE_SECONDS {
                    continue;
                }

                fs::create_dir_all(&quarantine_dir)?;
                let quarantined_path = quarantine_dir.join(&file_name);
                self.validate_note_workspace_path(&quarantined_path)?;
                if quarantined_path.exists() {
                    continue;
                }
                fs::rename(&path, &quarantined_path)?;
                transaction.moves.push((path, quarantined_path));
                manifest.unreferenced_since.remove(&file_name);
            }

            if manifest.unreferenced_since.is_empty() {
                if manifest_path.exists() {
                    fs::remove_file(&manifest_path)?;
                }
            } else {
                atomic_write_json(&manifest_path, &manifest)?;
            }

            Ok(())
        })();
        if let Err(error) = maintenance_result {
            rollback_note_asset_transaction(Some(transaction));
            return Err(error);
        }

        Ok(Some(transaction))
    }

    fn enrich_note_source_link_assets(&self, links: &mut [SourceLink]) {
        let mut segments_by_entry: BTreeMap<EntryId, Vec<SourceSegment>> = BTreeMap::new();

        for link in links {
            for source in &mut link.sources {
                if source.snapshot_asset_path.is_some() && source.bbox.is_some() {
                    continue;
                }

                if !segments_by_entry.contains_key(&source.entry_id) {
                    let segments = self.read_segments(&source.entry_id).unwrap_or_default();
                    segments_by_entry.insert(source.entry_id.clone(), segments);
                }

                if let Some(segment) =
                    segments_by_entry
                        .get(&source.entry_id)
                        .and_then(|segments| {
                            neuink_domain::find_source_segment(segments, &source.segment_uid)
                        })
                {
                    if source.snapshot_asset_path.is_none() {
                        source.snapshot_asset_path = segment.asset_path.clone();
                    }
                    if source.bbox.is_none() {
                        source.bbox = segment.bbox;
                    }
                }
            }
        }
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

fn note_revision(note_source: &str, links: &[SourceLink]) -> Result<String, WorkspaceError> {
    let markdown = strip_frontmatter(note_source);
    let referenced_links = prune_note_link_refs(markdown, links);
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"neuink-note-v2\0");
    hasher.update(note_source.as_bytes());
    hasher.update(b"\0referenced-links\0");
    hasher.update(&serde_json::to_vec(&referenced_links)?);
    Ok(hasher.finalize().to_hex().to_string())
}

fn validate_and_prune_note_links(
    entry_id: &EntryId,
    note_id: &NoteId,
    markdown: &str,
    links: &[SourceLink],
) -> Result<Vec<SourceLink>, WorkspaceError> {
    validate_owned_note_links(
        &LinkOwner::Note {
            entry_id: entry_id.clone(),
            note_id: note_id.clone(),
        },
        markdown,
        links,
    )
}

pub(crate) fn validate_owned_note_links(
    owner: &LinkOwner,
    markdown: &str,
    links: &[SourceLink],
) -> Result<Vec<SourceLink>, WorkspaceError> {
    let mut anchor_ids = BTreeSet::new();
    for link in links {
        if link.anchor_id.trim().is_empty() {
            return Err(WorkspaceError::InvalidNoteDocument(
                "source link anchor id is empty".to_string(),
            ));
        }
        if !anchor_ids.insert(link.anchor_id.as_str()) {
            return Err(WorkspaceError::InvalidNoteDocument(format!(
                "duplicate source link anchor id: {}",
                link.anchor_id
            )));
        }
        if &link.owner != owner {
            return Err(WorkspaceError::InvalidNoteDocument(format!(
                "source link {} belongs to another note",
                link.anchor_id
            )));
        }
    }
    Ok(prune_note_links(markdown, links))
}

fn prune_note_links(markdown: &str, links: &[SourceLink]) -> Vec<SourceLink> {
    prune_note_link_refs(markdown, links)
        .into_iter()
        .cloned()
        .collect()
}

fn prune_note_link_refs<'a>(markdown: &str, links: &'a [SourceLink]) -> Vec<&'a SourceLink> {
    links
        .iter()
        .filter(|link| markdown.contains(&format!("[^{}]", link.anchor_id)))
        .collect()
}

fn referenced_note_asset_names(markdown: &str, note_id: &NoteId) -> BTreeSet<String> {
    let normalized = markdown.replace('\\', "/");
    let prefix = format!("{}.assets/", note_id.as_str());
    let mut referenced = BTreeSet::new();
    let mut remaining = normalized.as_str();

    while let Some(prefix_index) = remaining.find(&prefix) {
        let candidate = &remaining[prefix_index + prefix.len()..];
        let end = candidate
            .find(|character: char| {
                character.is_whitespace() || matches!(character, '\'' | '"' | '(' | ')' | '<' | '>')
            })
            .unwrap_or(candidate.len());
        let file_name = &candidate[..end];
        if !file_name.contains('/') && is_managed_note_asset_name(file_name) {
            referenced.insert(file_name.to_string());
        }
        remaining = &candidate[end..];
        if remaining.is_empty() {
            break;
        }
    }

    referenced
}

fn is_managed_note_asset_name(file_name: &str) -> bool {
    let path = Path::new(file_name);
    if path.components().count() != 1 {
        return false;
    }
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    if !matches!(
        extension.to_ascii_lowercase().as_str(),
        "avif" | "gif" | "jpeg" | "jpg" | "png" | "webp"
    ) {
        return false;
    }
    let Some(stem) = path.file_stem().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some((_, hash_suffix)) = stem.rsplit_once('-') else {
        return false;
    };
    hash_suffix.len() == 12
        && hash_suffix
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn rollback_note_asset_transaction(transaction: Option<NoteAssetTransaction>) {
    let Some(transaction) = transaction else {
        return;
    };
    for (source, target) in transaction.moves.into_iter().rev() {
        if target.exists() && !source.exists() {
            let _ = fs::rename(target, source);
        }
    }
    restore_optional_file(
        &transaction.manifest_path,
        transaction.previous_manifest.as_deref(),
    );
}

fn note_write_lock(note_path: &Path) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let locks = LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(lock) = locks.get(note_path).and_then(Weak::upgrade) {
        return lock;
    }
    locks.retain(|_, lock| lock.strong_count() > 0);
    let lock = Arc::new(Mutex::new(()));
    locks.insert(note_path.to_path_buf(), Arc::downgrade(&lock));
    lock
}

fn restore_optional_file(path: &Path, previous: Option<&[u8]>) {
    match previous {
        Some(bytes) => {
            let _ = atomic_write(path, bytes);
        }
        None => {
            if path.exists() {
                let _ = fs::remove_file(path);
            }
        }
    }
}

pub(crate) fn strip_frontmatter(markdown: &str) -> &str {
    let Some(rest) = markdown.strip_prefix("---\n") else {
        return markdown;
    };
    let Some(end) = rest.find("\n---\n") else {
        return markdown;
    };
    let body = &rest[end + "\n---\n".len()..];
    body.strip_prefix('\n').unwrap_or(body)
}
