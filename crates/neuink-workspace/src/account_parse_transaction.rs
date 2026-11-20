use crate::{
    atomic_write, atomic_write_json, tag_reading::validate_id, workspace::reading_snapshot,
    Workspace, WorkspaceError,
};
use neuink_domain::{EntryId, EntryMeta, SourceSegment};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Cursor, Read},
    path::Path,
};
const JOURNAL: &str = "account-parse.journal.json";
const MAX_ZIP: usize = 256 * 1024 * 1024;
const MAX_EXTRACTED: u64 = 1024 * 1024 * 1024;
#[derive(Serialize, Deserialize)]
struct Record {
    version: u8,
    entry_id: EntryId,
    token: String,
    zip_hash: String,
    stage_hash: String,
    before_meta: String,
    before_segments: Option<String>,
    before_zip: Option<String>,
    before_dir: bool,
    after_meta: EntryMeta,
    segments: Vec<SourceSegment>,
}
fn failure() -> WorkspaceError {
    WorkspaceError::PdfQueue("解析结果恢复遇到文件冲突，已保留恢复记录和当前内容".into())
}
fn invalid() -> WorkspaceError {
    WorkspaceError::PdfQueue("解析结果 ZIP 无效或超过限制".into())
}
fn hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}
fn file_hash(path: &Path) -> Result<Option<String>, WorkspaceError> {
    match fs::read(path) {
        Ok(b) => Ok(Some(hash(&b))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}
fn directory_hash(root: &Path) -> Result<String, WorkspaceError> {
    fn visit(base: &Path, dir: &Path, hash: &mut blake3::Hasher) -> Result<(), WorkspaceError> {
        let mut entries = fs::read_dir(dir)?.collect::<Result<Vec<_>, _>>()?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let path = entry.path();
            let relative = path.strip_prefix(base).map_err(|_| failure())?;
            let name = relative.to_str().ok_or_else(failure)?;
            let metadata = fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink() {
                return Err(failure());
            }
            hash.update(&(name.len() as u64).to_le_bytes());
            hash.update(name.as_bytes());
            if metadata.is_dir() {
                hash.update(b"d");
                visit(base, &path, hash)?;
            } else if metadata.is_file() {
                hash.update(b"f");
                hash.update(&metadata.len().to_le_bytes());
                let mut file = fs::File::open(path)?;
                let mut buffer = [0u8; 65536];
                loop {
                    let count = file.read(&mut buffer)?;
                    if count == 0 {
                        break;
                    }
                    hash.update(&buffer[..count]);
                }
            } else {
                return Err(failure());
            }
        }
        Ok(())
    }
    let mut hash = blake3::Hasher::new();
    visit(root, root, &mut hash)?;
    Ok(hash.finalize().to_hex().to_string())
}
fn prepare_stage(ws: &Workspace, stage: &Path, bytes: &[u8]) -> Result<(), WorkspaceError> {
    if bytes.len() > MAX_ZIP {
        return Err(invalid());
    }
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid())?;
    if archive.len() > 10000 {
        return Err(invalid());
    }
    fs::create_dir(stage)?;
    let result = (|| -> Result<(), WorkspaceError> {
        let mut names = HashSet::new();
        let mut total = 0u64;
        for index in 0..archive.len() {
            let mut item = archive.by_index(index).map_err(|_| invalid())?;
            let name = item.enclosed_name().ok_or_else(invalid)?.to_path_buf();
            if name.as_os_str().is_empty()
                || name == Path::new("full.zip")
                || !names.insert(name.clone())
            {
                return Err(invalid());
            }
            if item
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(invalid());
            }
            total = total.checked_add(item.size()).ok_or_else(invalid)?;
            if total > MAX_EXTRACTED {
                return Err(invalid());
            }
            let target = stage.join(name);
            if item.is_dir() {
                fs::create_dir_all(target)?;
                continue;
            }
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut out = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(target)?;
            let size = item.size();
            let n = std::io::copy(&mut item.by_ref().take(size + 1), &mut out)?;
            if n != item.size() {
                return Err(invalid());
            }
            out.sync_all()?;
        }
        atomic_write(stage.join("full.zip"), bytes)?;
        ws.promote_mineru_output_directory(stage)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(stage);
    }
    result
}
impl Workspace {
    pub(crate) fn commit_account_parse_result(
        &self,
        entry_id: &EntryId,
        zip: &[u8],
        entry: &EntryMeta,
        segments: &[SourceSegment],
    ) -> Result<(), WorkspaceError> {
        validate_id(entry_id.as_str())?;
        let journal = self.layout().root().join(JOURNAL);
        self.validate_note_workspace_path(&journal)?;
        if journal.exists() {
            return Err(failure());
        }
        let token = EntryId::new().to_string();
        let entry_dir = self.layout().entry_dir(entry_id);
        let stage = entry_dir.join(format!(".account-parse-stage-{token}"));
        self.validate_note_workspace_path(&stage)?;
        prepare_stage(self, &stage, zip)?;
        let out = self.layout().entry_mineru_output_dir(entry_id);
        let record = Record {
            version: 2,
            entry_id: entry_id.clone(),
            token,
            zip_hash: hash(zip),
            stage_hash: directory_hash(&stage)?,
            before_meta: file_hash(&self.layout().entry_meta_file(entry_id))?
                .ok_or_else(failure)?,
            before_segments: file_hash(&self.layout().entry_segments_file(entry_id))?,
            before_zip: file_hash(&self.layout().entry_mineru_output_zip(entry_id))?,
            before_dir: out.exists(),
            after_meta: entry.clone(),
            segments: segments.to_vec(),
        };
        if let Err(e) = atomic_write_json(journal, &record) {
            let _ = fs::remove_dir_all(stage);
            return Err(e);
        }
        self.recover_account_parse_result()
    }
    pub(crate) fn recover_account_parse_result(&self) -> Result<(), WorkspaceError> {
        let journal = self.layout().root().join(JOURNAL);
        self.validate_note_workspace_path(&journal)?;
        let raw = match fs::read(&journal) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let r: Record = serde_json::from_slice(&raw)?;
        validate_id(r.entry_id.as_str())?;
        validate_id(&r.token)?;
        if r.version != 2 || r.after_meta.id != r.entry_id {
            return Err(failure());
        }
        let entry_dir = self.layout().entry_dir(&r.entry_id);
        let stage = entry_dir.join(format!(".account-parse-stage-{}", r.token));
        let backup = entry_dir.join(format!(".account-parse-backup-{}", r.token));
        let output = self.layout().entry_mineru_output_dir(&r.entry_id);
        let meta = self.layout().entry_meta_file(&r.entry_id);
        let seg = self.layout().entry_segments_file(&r.entry_id);
        for p in [&stage, &backup, &output, &meta, &seg] {
            self.validate_note_workspace_path(p)?;
        }
        let after_meta = serde_json::to_vec_pretty(&r.after_meta)?;
        let after_seg = serde_json::to_vec_pretty(&r.segments)?;
        let current_meta = file_hash(&meta)?;
        let current_seg = file_hash(&seg)?;
        if current_meta != Some(r.before_meta.clone()) && current_meta != Some(hash(&after_meta)) {
            return Err(failure());
        }
        if current_seg != r.before_segments && current_seg != Some(hash(&after_seg)) {
            return Err(failure());
        }
        let current_zip = file_hash(&output.join("full.zip"))?;
        if backup.exists()
            && (!r.before_dir || file_hash(&backup.join("full.zip"))? != r.before_zip)
        {
            return Err(failure());
        }
        let published =
            !stage.exists() && output.exists() && current_zip == Some(r.zip_hash.clone());
        if published && directory_hash(&output)? != r.stage_hash {
            return Err(failure());
        }
        if !published {
            if directory_hash(&stage)? != r.stage_hash {
                return Err(failure());
            }
            if file_hash(&stage.join("full.zip"))? != Some(r.zip_hash.clone()) {
                return Err(failure());
            }
            if output.exists() {
                if !r.before_dir || current_zip != r.before_zip || backup.exists() {
                    return Err(failure());
                }
                fs::rename(&output, &backup)?;
            } else if r.before_dir && !backup.exists() {
                return Err(failure());
            }
            fs::rename(&stage, &output)?;
        }
        atomic_write(seg, &after_seg)?;
        reading_snapshot::invalidate(self, &r.entry_id)?;
        atomic_write(meta, &after_meta)?;
        fs::remove_file(journal)?;
        if backup.exists() {
            if let Err(error) = fs::remove_dir_all(backup) {
                eprintln!("Could not remove old parse output: {error}");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn archive(name: &str) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        w.start_file(name, zip::write::SimpleFileOptions::default())
            .unwrap();
        w.write_all(b"result").unwrap();
        w.finish().unwrap().into_inner()
    }
    #[test]
    fn resumes_between_directory_renames_and_refuses_changed_metadata() {
        let root = std::env::temp_dir().join(format!("parse-recovery-{}", EntryId::new()));
        let ws = Workspace::create(&root).unwrap();
        let entry = ws.create_entry("paper").unwrap();
        let bytes = archive("paper.md");
        let output = ws.layout().entry_mineru_output_dir(&entry.id);
        fs::create_dir_all(&output).unwrap();
        fs::write(output.join("full.zip"), b"old").unwrap();
        let token = EntryId::new().to_string();
        let dir = ws.layout().entry_dir(&entry.id);
        let stage = dir.join(format!(".account-parse-stage-{token}"));
        let backup = dir.join(format!(".account-parse-backup-{token}"));
        prepare_stage(&ws, &stage, &bytes).unwrap();
        let rec = Record {
            version: 2,
            entry_id: entry.id.clone(),
            token,
            zip_hash: hash(&bytes),
            stage_hash: directory_hash(&stage).unwrap(),
            before_meta: file_hash(&ws.layout().entry_meta_file(&entry.id))
                .unwrap()
                .unwrap(),
            before_segments: None,
            before_zip: Some(hash(b"old")),
            before_dir: true,
            after_meta: entry.clone(),
            segments: vec![],
        };
        atomic_write_json(root.join(JOURNAL), &rec).unwrap();
        fs::rename(&output, &backup).unwrap();
        let meta = ws.layout().entry_meta_file(&entry.id);
        let original = fs::read(&meta).unwrap();
        fs::write(&meta, b"external").unwrap();
        assert!(ws.recover_account_parse_result().is_err());
        assert!(stage.exists());
        assert_eq!(fs::read(backup.join("full.zip")).unwrap(), b"old");
        fs::write(&meta, original).unwrap();
        drop(ws);
        let ws = Workspace::open_existing(&root).unwrap();
        assert_eq!(
            fs::read(ws.layout().entry_mineru_output_zip(&entry.id)).unwrap(),
            bytes
        );
        assert!(!backup.exists());
        assert!(!root.join(JOURNAL).exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    #[ignore = "requires a synthetic MinerU result ZIP supplied via NEUINK_MINERU_TEST_ZIP"]
    fn accepts_real_mineru_result_zip() {
        let zip_path = std::env::var_os("NEUINK_MINERU_TEST_ZIP").expect("NEUINK_MINERU_TEST_ZIP");
        let data = fs::read(zip_path).unwrap();
        let root = std::env::temp_dir().join(format!("parse-real-{}", EntryId::new()));
        let ws = Workspace::create(&root).unwrap();
        let entry = ws.create_entry("synthetic").unwrap();
        ws.commit_account_parse_result(&entry.id, &data, &entry, &[])
            .unwrap();
        assert_eq!(
            fs::read(ws.layout().entry_mineru_output_zip(&entry.id)).unwrap(),
            data
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn unsafe_zip_cannot_replace_existing_output() {
        let root = std::env::temp_dir().join(format!("parse-invalid-{}", EntryId::new()));
        let ws = Workspace::create(&root).unwrap();
        let entry = ws.create_entry("paper").unwrap();
        let out = ws.layout().entry_mineru_output_dir(&entry.id);
        fs::create_dir_all(&out).unwrap();
        fs::write(out.join("full.zip"), b"old").unwrap();
        assert!(ws
            .commit_account_parse_result(&entry.id, &archive("../evil"), &entry, &[])
            .is_err());
        assert_eq!(fs::read(out.join("full.zip")).unwrap(), b"old");
        assert!(!root.join(JOURNAL).exists());
        fs::remove_dir_all(root).unwrap();
    }
}
