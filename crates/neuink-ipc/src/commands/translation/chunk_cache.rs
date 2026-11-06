use super::*;

#[derive(Clone)]
pub(crate) struct ChunkCache {
    workspace: Workspace,
    entry: EntryId,
    keys: Arc<Mutex<HashSet<String>>>,
}
impl ChunkCache {
    pub(crate) fn new(workspace: Workspace, entry: EntryId) -> Self {
        Self { workspace, entry, keys: Arc::new(Mutex::new(HashSet::new())) }
    }
    pub(crate) fn read(&self, key: &str) -> Result<Option<String>, String> {
        self.keys.lock().map_err(|_| "分块缓存锁不可用")?.insert(key.to_string());
        self.workspace
            .read_translation_chunk(&self.entry, key)
            .map_err(|e| e.to_string())
    }
    pub(crate) fn write(&self, key: &str, text: &str) -> Result<(), String> {
        self.keys.lock().map_err(|_| "分块缓存锁不可用")?.insert(key.to_string());
        self.workspace
            .write_translation_chunk(&self.entry, key, text)
            .map_err(|e| e.to_string())
    }
    pub(crate) fn committed(&self, source: &str) -> Result<(), String> {
        let prefix = format!("{}:", blake3::hash(source.as_bytes()));
        let mut keys = self.keys.lock().map_err(|_| "分块缓存锁不可用")?;
        let completed: Vec<_> = keys.iter().filter(|key| key.starts_with(&prefix)).cloned().collect();
        for key in completed {
            self.workspace.remove_translation_chunk(&self.entry, &key).map_err(|e| e.to_string())?;
            keys.remove(&key);
        }
        Ok(())
    }
}
