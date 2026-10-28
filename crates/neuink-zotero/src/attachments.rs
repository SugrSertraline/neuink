use crate::Attachment;
use std::path::{Component, Path, PathBuf};

fn safe_join(base: &Path, relative: &str) -> Option<PathBuf> {
    let relative = relative.replace('\\', "/");
    let path = Path::new(&relative);
    if path
        .components()
        .any(|p| !matches!(p, Component::Normal(_)))
        || relative.contains(':')
    {
        return None;
    }
    let joined = base.join(path);
    // Existing symlinks cannot escape a stored attachment's directory.
    if joined.exists()
        && !joined
            .canonicalize()
            .ok()?
            .starts_with(base.canonicalize().ok()?)
    {
        return None;
    }
    Some(joined)
}

pub(crate) fn resolve(
    directory: &Path,
    linked: Option<&Path>,
    key: String,
    mode: i64,
    raw: String,
) -> Attachment {
    let path = if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric()) {
        None
    } else if matches!(mode, 0 | 1) {
        raw.strip_prefix("storage:")
            .and_then(|relative| safe_join(&directory.join("storage").join(&key), relative))
    } else if mode == 2 {
        if let Some(relative) = raw.strip_prefix("attachments:") {
            linked.and_then(|base| safe_join(base, relative))
        } else {
            let p = PathBuf::from(&raw);
            p.is_absolute().then_some(p)
        }
    } else {
        None
    };
    let metadata = path
        .as_ref()
        .and_then(|p| std::fs::metadata(p).ok())
        .filter(|m| m.is_file());
    let available = metadata.is_some();
    let reason = if available {
        None
    } else if raw.starts_with("attachments:") && linked.is_none() {
        Some("需要设置链接附件基础目录".into())
    } else if raw.starts_with("attachments:") && path.is_some() {
        Some("链接附件未找到，请检查基础目录或文件是否已移动".into())
    } else if path.is_some() {
        Some("附件未下载或文件已移动".into())
    } else {
        Some("附件路径不可用".into())
    };
    let display_path = raw
        .strip_prefix("storage:")
        .or_else(|| raw.strip_prefix("attachments:"))
        .unwrap_or(&raw);
    let file_name = display_path
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(display_path)
        .to_string();
    Attachment {
        key,
        file_name,
        available,
        reason,
        path,
        file_size: metadata.as_ref().map_or(0, |m| m.len()),
        modified: metadata.and_then(|m| m.modified().ok()),
    }
}
