use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub(super) type Manifest = BTreeMap<PathBuf, Option<blake3::Hash>>;

pub(super) fn regular(path: &Path) -> Result<fs::Metadata, String> {
    let meta = fs::symlink_metadata(path).map_err(|_| "无法读取旧资料文件。")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("旧资料包含链接或联接目录，已保留原目录。".into());
        }
    }
    if meta.file_type().is_symlink() || (!meta.is_dir() && !meta.is_file()) {
        return Err("旧资料包含不支持的文件类型，已保留原目录。".into());
    }
    Ok(meta)
}

pub(super) fn snapshot(root: &Path) -> Result<Manifest, String> {
    let mut manifest = Manifest::new();
    if root.exists() {
        regular(root)?;
        walk(root, Path::new(""), &mut manifest)?;
    }
    Ok(manifest)
}

fn walk(root: &Path, relative: &Path, result: &mut Manifest) -> Result<(), String> {
    for entry in fs::read_dir(root.join(relative)).map_err(|_| "无法读取资料目录。")? {
        let entry = entry.map_err(|_| "无法读取资料目录。")?;
        let relative = relative.join(entry.file_name());
        let path = root.join(&relative);
        if regular(&path)?.is_dir() {
            result.insert(relative.clone(), None);
            walk(root, &relative, result)?;
        } else {
            result.insert(relative, Some(hash(&path)?));
        }
    }
    Ok(())
}

pub(super) fn hash(path: &Path) -> Result<blake3::Hash, String> {
    let mut file = fs::File::open(path).map_err(|_| "资料文件无法读取或正在被占用。")?;
    let mut hash = blake3::Hasher::new();
    let mut bytes = [0; 64 * 1024];
    loop {
        let count = file.read(&mut bytes).map_err(|_| "读取资料失败。")?;
        if count == 0 {
            break;
        }
        hash.update(&bytes[..count]);
    }
    Ok(hash.finalize())
}

pub(super) fn copy_missing(
    source: &Path,
    target: &Path,
    manifest: &Manifest,
) -> Result<usize, String> {
    let mut conflicts = 0;
    for (relative, digest) in manifest {
        let destination = target.join(relative);
        // A file/folder collision also blocks its descendants; the new data always wins.
        if destination
            .ancestors()
            .skip(1)
            .take_while(|p| *p != target)
            .any(|p| p.is_file())
        {
            if digest.is_some() {
                conflicts += 1;
            }
            continue;
        }
        if destination.exists() {
            if digest.is_some() && (!destination.is_file() || Some(hash(&destination)?) != *digest)
            {
                conflicts += 1;
            }
            continue;
        }
        if digest.is_none() {
            fs::create_dir_all(&destination).map_err(|_| "无法创建数据目录，请检查磁盘空间。")?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|_| "无法创建数据目录。")?;
        }
        let mut input = fs::File::open(source.join(relative)).map_err(|_| "旧资料无法读取。")?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
            .map_err(|_| "无法复制资料，请检查磁盘空间和权限。")?;
        let mut bytes = [0; 64 * 1024];
        loop {
            let count = input.read(&mut bytes).map_err(|_| "读取资料失败。")?;
            if count == 0 {
                break;
            }
            output
                .write_all(&bytes[..count])
                .map_err(|_| "复制资料失败，请检查磁盘空间。")?;
        }
        output.sync_all().map_err(|_| "数据未完整写入磁盘。")?;
        if Some(hash(&destination)?) != *digest {
            return Err("复制校验失败，已保留原目录。".into());
        }
    }
    Ok(conflicts)
}
