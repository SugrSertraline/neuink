//! Disposable hints for resource discovery, never authority for upload or apply.
//! A process restart or explicit invalidation ends the trusted observation window.
use super::{
    files::{fingerprint, safe_path},
    invalid,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const FORMAT: u8 = 1;
const MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_RECORD_BYTES: u64 = 4096;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(super) struct Stamp {
    size: u64,
    modified_ns: i128,
    identity: Vec<u64>,
}

impl Stamp {
    pub fn read(path: &Path) -> io::Result<Self> {
        let meta = fs::metadata(path)?;
        if !meta.is_file() {
            return Err(invalid("附件不是普通文件"));
        }
        let modified_ns = match meta.modified()?.duration_since(UNIX_EPOCH) {
            Ok(age) => age.as_nanos() as i128,
            Err(before_epoch) => -(before_epoch.duration().as_nanos() as i128),
        };
        #[cfg(windows)]
        let identity = {
            use std::os::windows::fs::MetadataExt;
            vec![
                meta.creation_time(),
                meta.last_write_time(),
                meta.file_attributes() as u64,
            ]
        };
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            vec![
                meta.dev(),
                meta.ino(),
                meta.ctime() as u64,
                meta.ctime_nsec() as u64,
            ]
        };
        #[cfg(not(any(windows, unix)))]
        let identity = Vec::new();
        Ok(Self {
            size: meta.len(),
            modified_ns,
            identity,
        })
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    format: u8,
    scope: String,
    session: String,
    generation: u64,
    stamp: Stamp,
    hash: String,
    verified_at: u64,
    checksum: String,
}

impl Record {
    fn checksum(&self) -> io::Result<String> {
        let bytes = serde_json::to_vec(&(
            self.format,
            &self.scope,
            &self.session,
            self.generation,
            &self.stamp,
            &self.hash,
            self.verified_at,
        ))
        .map_err(io::Error::other)?;
        Ok(blake3::hash(&bytes).to_hex().to_string())
    }
}

fn generations() -> &'static Mutex<BTreeMap<PathBuf, u64>> {
    static GENERATIONS: OnceLock<Mutex<BTreeMap<PathBuf, u64>>> = OnceLock::new();
    GENERATIONS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn generation(root: &Path) -> io::Result<u64> {
    let entries = generations()
        .lock()
        .map_err(|_| invalid("附件索引锁不可用"))?;
    Ok(entries.get(root).copied().unwrap_or_default())
}

fn session() -> &'static str {
    static SESSION: OnceLock<String> = OnceLock::new();
    SESSION.get_or_init(|| neuink_domain::EntryId::new().to_string())
}

/// Invalidating hints does not remove queued operations, immutable blobs or papers.
pub fn invalidate_incremental_cache(root: &Path) -> io::Result<()> {
    let root = root.canonicalize()?;
    let mut entries = generations()
        .lock()
        .map_err(|_| invalid("附件索引锁不可用"))?;
    let value = entries.entry(root).or_default();
    *value = value
        .checked_add(1)
        .ok_or_else(|| invalid("附件索引代数已耗尽"))?;
    Ok(())
}

/// Watch notifications identify candidates, including changes that preserve timestamps.
pub fn invalidate_incremental_paths(root: &Path, relative_paths: &[String]) -> io::Result<()> {
    let root = root.canonicalize()?;
    for relative in relative_paths {
        match fs::remove_file(record_path(&root, relative)?) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

fn scope(root: &Path) -> io::Result<String> {
    let mut hash = blake3::Hasher::new();
    hash.update(root.to_string_lossy().as_bytes());
    match fs::read(safe_path(root, "sync-binding.json")?) {
        Ok(bytes) => {
            hash.update(&bytes);
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    Ok(hash.finalize().to_hex().to_string())
}

fn record_path(root: &Path, relative: &str) -> io::Result<PathBuf> {
    #[cfg(windows)]
    let relative = relative.replace('\\', "/").to_lowercase();
    let key = blake3::hash(relative.as_bytes()).to_hex();
    safe_path(root, &format!(".neuink-sync/fingerprints/{key}.json"))
}

fn read_record(path: &Path) -> Option<Record> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_RECORD_BYTES {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    let record: Record = serde_json::from_slice(&bytes).ok()?;
    (record.checksum().ok()? == record.checksum).then_some(record)
}

pub(super) fn resource(
    root: &Path,
    relative: &str,
    path: &Path,
) -> io::Result<(String, u64, Stamp)> {
    let before = Stamp::read(path)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?
        .as_secs();
    // An unreadable/invalid cache is always a miss, never a blocked user write.
    let cache = record_path(root, relative).ok();
    let scope = scope(root).ok();
    let generation = generation(root)?;
    if let (Some(cache), Some(scope)) = (&cache, &scope) {
        if let Some(record) = read_record(cache) {
            if record.format == FORMAT
                && record.scope == *scope
                && record.session == session()
                && record.generation == generation
                && record.stamp == before
                && now
                    .checked_sub(record.verified_at)
                    .is_some_and(|age| age < MAX_AGE.as_secs())
                && record.hash.len() == 64
                && record
                    .hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Ok((record.hash, before.size, before));
            }
        }
    }
    let (hash, size) = fingerprint(path)?.ok_or_else(|| invalid("引用的附件缺失"))?;
    let after = Stamp::read(path)?;
    if before != after || size != after.size {
        return Err(invalid("核对期间附件已变化，请重试"));
    }
    if let (Some(cache), Some(scope)) = (cache, scope) {
        let mut record = Record {
            format: FORMAT,
            scope,
            session: session().into(),
            generation,
            stamp: after.clone(),
            hash: hash.clone(),
            verified_at: now,
            checksum: String::new(),
        };
        record.checksum = record.checksum()?;
        // Hints are optional. Failure to write one merely causes a later rehash.
        let _ = crate::atomic_write_json(cache, &record);
    }
    Ok((hash, size, after))
}

#[cfg(test)]
pub(super) fn rewrite_record_field(path: &Path, field: &str, value: serde_json::Value) {
    let mut content: serde_json::Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    content[field] = value;
    let mut record: Record = serde_json::from_value(content).unwrap();
    record.checksum = record.checksum().unwrap();
    fs::write(path, serde_json::to_vec(&record).unwrap()).unwrap();
}
