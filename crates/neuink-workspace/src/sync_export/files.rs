use neuink_sync_protocol::document::{portable_resource_name, Resource};
use std::{
    collections::BTreeMap,
    fs,
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use super::{invalid, ExportBundle};

const MAX_DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_BLOB_BYTES: u64 = 2_147_483_648;

pub(super) struct Files {
    root: PathBuf,
    trashed_entry: Option<String>,
    observed: BTreeMap<String, Option<String>>,
    directories: BTreeMap<String, Vec<String>>,
    pub blobs: BTreeMap<String, BlobSource>,
}

// Host paths deliberately have no Serialize implementation. Only Resource goes
// over the wire; attachment bytes are read through the hash-checking API below.
pub(super) enum BlobSource {
    File { relative: String, size: u64 },
    Bytes(Vec<u8>),
}

pub(crate) fn safe_path(root: &Path, relative: &str) -> io::Result<PathBuf> {
    if !portable_resource_name(relative) {
        return Err(invalid("资源路径不是安全的相对路径"));
    }
    let mut path = root.to_path_buf();
    for component in relative.split('/') {
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !path.canonicalize()?.starts_with(root) {
                    return Err(invalid("同步导出拒绝链接及工作区外部文件"));
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(path)
}

pub(crate) fn fingerprint(path: &Path) -> io::Result<Option<(String, u64)>> {
    let mut file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let before = file.metadata()?;
    if !before.is_file() || before.len() > MAX_BLOB_BYTES {
        return Err(invalid("附件不是普通文件或超过 2 GiB"));
    }
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 65536];
    let mut size = 0;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        if size > MAX_BLOB_BYTES {
            return Err(invalid("附件超过 2 GiB"));
        }
        hasher.update(&buffer[..count]);
    }
    let after = fs::metadata(path)?;
    if size != before.len() || size != after.len() || before.modified()? != after.modified()? {
        return Err(invalid("导出期间文件发生变化，请重试"));
    }
    Ok(Some((hasher.finalize().to_hex().to_string(), size)))
}

impl Files {
    pub fn new(root: &Path) -> io::Result<Self> {
        Ok(Self {
            root: root.canonicalize()?,
            trashed_entry: None,
            observed: BTreeMap::new(),
            directories: BTreeMap::new(),
            blobs: BTreeMap::new(),
        })
    }

    pub fn for_trashed_entry(root: &Path, entry: &str) -> io::Result<Self> {
        super::id(entry)?;
        let mut files = Self::new(root)?;
        files.trashed_entry = Some(entry.into());
        Ok(files)
    }
    fn path(&self, relative: &str) -> io::Result<PathBuf> {
        if let Some(entry) = &self.trashed_entry {
            if relative.starts_with(&format!("entries/{entry}/")) {
                return safe_path(&self.root, &format!("trash/{relative}"));
            }
        }
        safe_path(&self.root, relative)
    }

    fn observe(&mut self, relative: &str, hash: Option<String>) -> io::Result<()> {
        if self.observed.get(relative).is_some_and(|old| old != &hash) {
            return Err(invalid("导出期间文件发生变化，请重试"));
        }
        self.observed.insert(relative.into(), hash);
        Ok(())
    }

    pub fn read_optional(&mut self, relative: &str) -> io::Result<Option<Vec<u8>>> {
        let path = self.path(relative)?;
        let file = match fs::File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.observe(relative, None)?;
                return Ok(None);
            }
            Err(error) => return Err(error),
        };
        let mut bytes = Vec::new();
        file.take(MAX_DOCUMENT_BYTES + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_DOCUMENT_BYTES {
            return Err(invalid("结构化文档超过 64 MiB，未导出"));
        }
        self.observe(relative, Some(blake3::hash(&bytes).to_hex().to_string()))?;
        Ok(Some(bytes))
    }

    pub fn read(&mut self, relative: &str) -> io::Result<Vec<u8>> {
        self.read_optional(relative)?
            .ok_or_else(|| invalid(&format!("同步所需的正文或引用文件缺失：{relative}")))
    }

    pub fn list(&mut self, relative: &str) -> io::Result<Vec<String>> {
        let names = directory_names(&self.path(relative)?)?;
        if self
            .directories
            .get(relative)
            .is_some_and(|old| old != &names)
        {
            return Err(invalid("解析补充文件清单已变化，请重试"));
        }
        self.directories.insert(relative.into(), names.clone());
        Ok(names)
    }

    pub fn resource(&mut self, relative: &str, name: &str) -> io::Result<Resource> {
        let path = self.path(relative)?;
        let (hash, size) =
            fingerprint(&path)?.ok_or_else(|| invalid("引用的附件缺失，不能保证完整恢复"))?;
        self.observe(relative, Some(hash.clone()))?;
        self.blobs
            .entry(hash.clone())
            .or_insert_with(|| BlobSource::File {
                relative: relative.into(),
                size,
            });
        Ok(Resource {
            name: name.into(),
            hash,
            size,
        })
    }

    pub fn generated(&mut self, name: &str, bytes: Vec<u8>) -> Resource {
        let hash = blake3::hash(&bytes).to_hex().to_string();
        let size = bytes.len() as u64;
        self.blobs
            .entry(hash.clone())
            .or_insert(BlobSource::Bytes(bytes));
        Resource {
            name: name.into(),
            hash,
            size,
        }
    }

    pub fn verify(&self) -> io::Result<()> {
        for (relative, expected) in &self.directories {
            if &directory_names(&self.path(relative)?)? != expected {
                return Err(invalid("解析补充文件清单已变化，请重试"));
            }
        }
        for (relative, expected) in &self.observed {
            let actual = fingerprint(&self.path(relative)?)?.map(|(hash, _)| hash);
            if &actual != expected {
                return Err(invalid("源内容已变化，请重新生成同步清单"));
            }
        }
        Ok(())
    }

    fn chunk(&self, hash: &str, offset: u64, length: usize) -> io::Result<Vec<u8>> {
        if length == 0 || length > 4 * 1024 * 1024 {
            return Err(invalid("附件读取块必须在 1 字节至 4 MiB 之间"));
        }
        match self
            .blobs
            .get(hash)
            .ok_or_else(|| invalid("附件不在本次清单中"))?
        {
            BlobSource::Bytes(bytes) => {
                if offset > bytes.len() as u64 {
                    return Err(invalid("附件读取位置越界"));
                }
                let start = offset as usize;
                Ok(bytes[start..bytes.len().min(start + length)].to_vec())
            }
            BlobSource::File { relative, size } => {
                if offset > *size {
                    return Err(invalid("附件读取位置越界"));
                }
                let mut file = fs::File::open(self.path(relative)?)?;
                if file.metadata()?.len() != *size {
                    return Err(invalid("附件已变化，请重新生成同步清单"));
                }
                file.seek(SeekFrom::Start(offset))?;
                let mut bytes = vec![0; (*size - offset).min(length as u64) as usize];
                file.read_exact(&mut bytes)?;
                Ok(bytes)
            }
        }
    }

    pub fn bytes(&self, hash: &str) -> io::Result<Vec<u8>> {
        match self
            .blobs
            .get(hash)
            .ok_or_else(|| invalid("附件不在本次清单中"))?
        {
            BlobSource::Bytes(bytes) => Ok(bytes.clone()),
            BlobSource::File { relative, size } => {
                // This helper is for inspection/small attachments. Uploads must
                // stream and revalidate rather than allocate a multi-GiB PDF.
                if *size > MAX_DOCUMENT_BYTES {
                    return Err(invalid("大附件必须通过分块流读取"));
                }
                let file = fs::File::open(self.path(relative)?)?;
                let mut bytes = Vec::new();
                file.take(*size + 1).read_to_end(&mut bytes)?;
                if bytes.len() as u64 != *size || blake3::hash(&bytes).to_hex().as_str() != hash {
                    return Err(invalid("附件已变化，请重新生成同步清单"));
                }
                Ok(bytes)
            }
        }
    }
}

fn directory_names(path: &Path) -> io::Result<Vec<String>> {
    let items = match fs::read_dir(path) {
        Ok(items) => items,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut names = Vec::new();
    for item in items {
        names.push(
            item?
                .file_name()
                .into_string()
                .map_err(|_| invalid("解析文件名不是有效文字"))?,
        );
    }
    names.sort();
    Ok(names)
}

impl ExportBundle {
    /// Recheck immediately before publication. A preview is not permission to
    /// publish a newer on-disk document or a half-completed local transaction.
    pub fn verify_unchanged(&self) -> io::Result<()> {
        let _guard = crate::tag_transaction::lock_metadata().map_err(io::Error::other)?;
        self.verify_unchanged_locked()
    }
    pub(crate) fn verify_unchanged_locked(&self) -> io::Result<()> {
        self.files.verify()
    }

    pub fn attachment_bytes(&self, hash: &str) -> io::Result<Vec<u8>> {
        self.files.bytes(hash)
    }

    /// Bounded reads for resumable transport. The receiver must verify the full
    /// hash, and the publisher must call verify_unchanged before publishing refs.
    pub fn attachment_chunk(&self, hash: &str, offset: u64, length: usize) -> io::Result<Vec<u8>> {
        self.files.chunk(hash, offset, length)
    }
}
