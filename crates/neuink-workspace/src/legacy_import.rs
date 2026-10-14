//! Startup-only import into a closed library. Publish through a recoverable rename journal.
mod files;
mod metadata;
use files::{copy_missing, regular, snapshot, Manifest};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

const JOURNAL: &str = "legacy-import-pending.json";

pub struct LegacyImport {
    source: PathBuf,
    manifest: Manifest,
    pub conflicts: usize,
}

impl LegacyImport {
    /// Recheck immediately before recycling. Never clean up a changed, linked or incomplete source.
    pub fn source_unchanged(&self, requested: &Path) -> Result<bool, String> {
        regular(requested)?;
        Ok(
            fs::canonicalize(requested).map_err(|_| "旧目录不可用。")? == self.source
                && snapshot(&self.source)? == self.manifest,
        )
    }
}

#[derive(Serialize, Deserialize)]
struct Journal {
    stage: String,
    backup: String,
}

fn valid_name(name: &str, prefix: &str) -> bool {
    name.starts_with(prefix)
        && name.len() < 100
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
}

/// Complete an interrupted publication before any reader/writer opens the library.
pub fn recover(data: &Path) -> Result<(), String> {
    let file = data.join(JOURNAL);
    if !file.exists() {
        return Ok(());
    }
    let bytes = fs::read(&file).map_err(|_| "无法读取旧资料整理记录。")?;
    if bytes.len() > 4096 {
        return Err("旧资料整理记录无效。".into());
    }
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|_| "旧资料整理记录损坏，资料已保留。")?;
    if !valid_name(&journal.stage, ".legacy-stage-")
        || !valid_name(&journal.backup, ".legacy-backup-")
    {
        return Err("旧资料整理记录的目录无效。".into());
    }
    let target = data.join("library");
    let stage = data.join(&journal.stage);
    let backup = data.join(&journal.backup);
    for path in [&target, &stage, &backup] {
        if path.exists() {
            regular(path)?;
        }
    }
    if stage.exists() {
        validate(&stage)?;
        if target.exists() {
            if backup.exists() {
                return Err("旧资料整理目录冲突，资料已保留。".into());
            }
            fs::rename(&target, &backup).map_err(|_| "当前资料库仍被占用，旧目录已保留。")?;
        }
        fs::rename(&stage, &target).map_err(|_| "数据整理尚未完成，下次启动会恢复。")?;
    }
    if !target.exists() {
        if backup.exists() {
            fs::rename(&backup, &target).map_err(|_| "无法恢复原资料库。")?;
        }
        return Err("数据整理尚未完成，原资料已保留。".into());
    }
    validate(&target)?;
    // Only this generated backup is removed, after the complete replacement is validated.
    if backup.exists() {
        snapshot(&backup)?; // Reject reparse points before a recursive cleanup.
        fs::remove_dir_all(&backup).map_err(|_| "数据已整理，但临时备份清理失败。")?;
    }
    fs::remove_file(file).map_err(|_| "无法完成旧资料整理记录。")?;
    Ok(())
}

fn validate(root: &Path) -> Result<(), String> {
    let workspace =
        crate::Workspace::open_existing(root).map_err(|_| "资料库无法完整打开，旧目录已保留。")?;
    workspace
        .list_entries()
        .map_err(|_| "论文数据不完整，旧目录已保留。")?;
    workspace
        .list_trashed_entries()
        .map_err(|_| "回收内容不完整，旧目录已保留。")?;
    workspace
        .list_tags()
        .map_err(|_| "标签数据不完整，旧目录已保留。")?;
    Ok(())
}

pub fn merge(source: &Path, data: &Path) -> Result<LegacyImport, String> {
    regular(source)?;
    let source = fs::canonicalize(source).map_err(|_| "旧资料目录不可用。")?;
    let data = fs::canonicalize(data).map_err(|_| "当前数据目录不可用。")?;
    if source.starts_with(&data) || data.starts_with(&source) {
        return Err("旧目录与程序数据目录重叠，未整理。".into());
    }
    metadata::workspace_marker(&source)?;
    recover(&data)?;
    let target = data.join("library");
    let before = snapshot(&target)?;
    let manifest = snapshot(&source)?;
    if manifest.keys().chain(before.keys()).any(|path| {
        path.file_name()
            .is_some_and(|name| name == "tag-operation.journal.json")
            || path
                .components()
                .any(|part| part.as_os_str().to_string_lossy().starts_with(".purging-"))
    }) {
        return Err("资料库有未完成的写入记录，原目录已保留，请先在原程序中完成恢复。".into());
    }
    let stage = tempfile::Builder::new()
        .prefix(".legacy-stage-")
        .tempdir_in(&data)
        .map_err(|_| "无法暂存旧资料，请检查数据目录权限和空间。")?;
    copy_missing(&target, stage.path(), &before)?;
    let imported = metadata::importable(&source, &target, &manifest)?;
    let conflicts =
        copy_missing(&source, stage.path(), &imported)? + manifest.len() - imported.len();
    metadata::merge(&source, &target, stage.path(), &imported)?;
    validate(stage.path())?;
    if snapshot(&source)? != manifest || snapshot(&target)? != before {
        return Err("整理期间资料被其他程序修改，旧目录已保留，请关闭其他 Neuink 后重试。".into());
    }
    let journal = Journal {
        stage: stage
            .path()
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("临时目录名称无效。")?
            .into(),
        backup: format!(".legacy-backup-{}", neuink_domain::EntryId::new()),
    };
    crate::atomic_write_json(data.join(JOURNAL), &journal)
        .map_err(|_| "无法保存整理进度，旧目录已保留。")?;
    let _retained = stage.keep();
    recover(&data)?;
    Ok(LegacyImport {
        source,
        manifest,
        conflicts,
    })
}

#[cfg(test)]
mod tests;
