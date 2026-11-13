use super::{error, Result};
use crate::{
    sync_export::{
        files::{fingerprint, safe_path},
        ExportBundle,
    },
    Workspace,
};
use neuink_sync_protocol::document::Resource;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) fn blob_path(workspace: &Workspace, hash: &str) -> Result<PathBuf> {
    if hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    {
        return Err("附件哈希无效".into());
    }
    let root = workspace.layout().root().canonicalize().map_err(error)?;
    let path = safe_path(&root, &format!(".neuink-sync/blobs/{hash}")).map_err(error)?;
    fs::create_dir_all(path.parent().ok_or("附件目录无效")?).map_err(error)?;
    Ok(path)
}

pub(super) fn verify(path: &Path, hash: &str, size: u64) -> Result<()> {
    if fingerprint(path).map_err(error)? != Some((hash.into(), size)) {
        return Err("附件缺失或校验失败，未修改本地正文".into());
    }
    Ok(())
}

pub(super) fn stage(
    workspace: &Workspace,
    bundle: &ExportBundle,
    resource: &Resource,
) -> Result<()> {
    let path = blob_path(workspace, &resource.hash)?;
    if path.is_file() && verify(&path, &resource.hash, resource.size).is_ok() {
        return Ok(());
    }
    let mut temp =
        tempfile::NamedTempFile::new_in(path.parent().ok_or("附件目录无效")?).map_err(error)?;
    let mut offset = 0;
    while offset < resource.size {
        let bytes = bundle
            .attachment_chunk(&resource.hash, offset, 4 * 1024 * 1024)
            .map_err(error)?;
        if bytes.is_empty() {
            return Err("附件读取提前结束".into());
        }
        temp.write_all(&bytes).map_err(error)?;
        offset += bytes.len() as u64;
    }
    temp.as_file().sync_all().map_err(error)?;
    verify(temp.path(), &resource.hash, resource.size)?;
    temp.persist(&path).map_err(error)?;
    Ok(())
}

pub(super) fn read(workspace: &Workspace, resource: &Resource) -> Result<Vec<u8>> {
    if resource.size > 64 * 1024 * 1024 {
        return Err("结构化文档超过 64 MiB".into());
    }
    let path = blob_path(workspace, &resource.hash)?;
    verify(&path, &resource.hash, resource.size)?;
    let mut bytes = Vec::new();
    fs::File::open(path)
        .map_err(error)?
        .take(resource.size + 1)
        .read_to_end(&mut bytes)
        .map_err(error)?;
    if bytes.len() as u64 != resource.size
        || blake3::hash(&bytes).to_hex().as_str() != resource.hash
    {
        return Err("暂存内容已变化".into());
    }
    Ok(bytes)
}

pub(super) fn copy(source: &Path, target: &Path, hash: &str, size: u64) -> Result<()> {
    let parent = target.parent().ok_or("目标目录无效")?;
    fs::create_dir_all(parent).map_err(error)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    let mut input = fs::File::open(source).map_err(error)?.take(size + 1);
    std::io::copy(&mut input, &mut temp).map_err(error)?;
    temp.as_file().sync_all().map_err(error)?;
    verify(temp.path(), hash, size)?;
    temp.persist(target).map_err(error)?;
    Ok(())
}
