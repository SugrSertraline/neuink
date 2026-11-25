use super::*;
impl Workspace {
    pub fn pending_child_lifecycle_events(&self) -> Result<Vec<ChildEvent>, WorkspaceError> {
        let directory = self.child_path("sync-child-lifecycle")?;
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut events = Vec::new();
        for item in fs::read_dir(directory)? {
            let item = item?;
            let name = item
                .file_name()
                .into_string()
                .map_err(|_| failure("回收站事件文件名无效"))?;
            if !name.ends_with(".json") {
                continue;
            }
            let path = self.child_path(&format!("sync-child-lifecycle/{name}"))?;
            let event: ChildEvent = serde_json::from_slice(&fs::read(path)?)?;
            if event.version != 1
                || event.sequence == 0
                || event.binding != self.sync_binding()?
                || name != format!("{}.json", event.event_id)
            {
                return Err(failure("回收站事件版本或绑定不一致"));
            }
            crate::tag_reading::validate_id(&event.event_id)?;
            crate::tag_reading::validate_id(event.entry_id.as_str())?;
            events.push(event);
        }
        events.sort_by_key(|e| e.sequence);
        Ok(events)
    }
    pub fn acknowledge_child_lifecycle_event(
        &self,
        binding: &WorkspaceSyncBinding,
        id: &str,
    ) -> Result<(), WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        crate::tag_reading::validate_id(id)?;
        if self.sync_binding()?.as_ref() != Some(binding) {
            return Err(failure("回收站事件绑定已改变"));
        }
        match fs::remove_file(self.child_path(&format!("sync-child-lifecycle/{id}.json"))?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}
