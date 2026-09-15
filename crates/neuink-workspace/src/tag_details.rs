use crate::{Workspace, WorkspaceError};
use neuink_domain::{TagId, TagMeta};

impl Workspace {
    /// Compare the edited field only: an unrelated rename must not overwrite a description.
    pub fn update_tag_description(
        &self,
        tag_id: &TagId,
        description: String,
        expected_description: &str,
    ) -> Result<TagMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        crate::tag_reading::validate_id(tag_id.as_str())?;
        if description.len() > 64 * 1024 {
            return Err(WorkspaceError::TagReading("标签描述不能超过 64 KB".into()));
        }
        let mut file = self.read_workspace_file()?;
        let tag = file.tags.iter_mut().find(|tag| &tag.id == tag_id)
            .ok_or_else(|| WorkspaceError::TagMissing(tag_id.to_string()))?;
        if tag.description != expected_description {
            return Err(WorkspaceError::TagReading("标签描述已在其他位置修改，请保留草稿并重新加载".into()));
        }
        tag.description = description;
        tag.updated_at = chrono::Utc::now();
        let saved = tag.clone();
        self.write_workspace_file(&file)?;
        Ok(saved)
    }
}
