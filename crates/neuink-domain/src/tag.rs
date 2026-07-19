use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{DomainError, TagId};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct TagMeta {
    pub id: TagId,
    pub name: String,
    pub parent_id: Option<TagId>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl TagMeta {
    pub fn new(name: impl Into<String>, parent_id: Option<TagId>) -> Result<Self, DomainError> {
        let now = Utc::now();
        let tag = Self {
            id: TagId::new(),
            name: name.into(),
            parent_id,
            created_at: now,
            updated_at: now,
        };
        tag.validate()?;
        Ok(tag)
    }

    pub fn validate(&self) -> Result<(), DomainError> {
        if self.name.trim().is_empty() {
            return Err(DomainError::TagNameRequired);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::TagMeta;

    #[test]
    fn tag_requires_name() {
        assert!(TagMeta::new(" ", None).is_err());
    }
}
