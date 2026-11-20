//! Versioned entity envelopes. File names are logical resources, never host paths.
use crate::ObjectKind;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

pub const ENTITY_SCHEMA_VERSION: u16 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Resource {
    pub name: String,
    pub hash: String,
    pub size: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct EntityDocument {
    pub schema_version: u16,
    pub entity_id: String,
    pub kind: ObjectKind,
    pub payload: Value,
    pub resources: Vec<Resource>,
    /// Other stable entity IDs required to interpret this entity.
    pub references: Vec<String>,
}

pub fn portable_resource_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 1024
        && !name.contains(['\\', ':', '\0', '<', '>', '"', '|', '?', '*'])
        && name.split('/').all(|part| {
            !part.is_empty()
                && part != "."
                && part != ".."
                && !part.ends_with(['.', ' '])
                && !part.chars().any(char::is_control)
                && !matches!(
                    part.split('.')
                        .next()
                        .unwrap_or("")
                        .to_ascii_uppercase()
                        .as_str(),
                    "CON"
                        | "PRN"
                        | "AUX"
                        | "NUL"
                        | "COM1"
                        | "COM2"
                        | "COM3"
                        | "COM4"
                        | "COM5"
                        | "COM6"
                        | "COM7"
                        | "COM8"
                        | "COM9"
                        | "LPT1"
                        | "LPT2"
                        | "LPT3"
                        | "LPT4"
                        | "LPT5"
                        | "LPT6"
                        | "LPT7"
                        | "LPT8"
                        | "LPT9"
                )
        })
}

impl EntityDocument {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.schema_version != ENTITY_SCHEMA_VERSION {
            return Err("不支持的同步数据版本");
        }
        if self.entity_id.is_empty()
            || self.entity_id.len() > 512
            || self.entity_id.chars().any(char::is_control)
        {
            return Err("实体标识无效");
        }
        if !self.payload.is_object() {
            return Err("实体正文必须是结构化对象");
        }
        let mut names = BTreeSet::new();
        for resource in &self.resources {
            if !portable_resource_name(&resource.name)
                || !names.insert(resource.name.to_lowercase())
            {
                return Err("资源名称不安全或发生跨平台冲突");
            }
            if resource.hash.len() != 64
                || !resource
                    .hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                || resource.size > 2147483648
            {
                return Err("资源内容标识无效");
            }
        }
        let mut references = BTreeSet::new();
        for reference in &self.references {
            if reference.is_empty()
                || reference.len() > 512
                || reference.chars().any(char::is_control)
                || !references.insert(reference)
            {
                return Err("实体引用无效");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_host_paths_and_cross_platform_aliases() {
        for path in [
            "/paper.pdf",
            "../paper.pdf",
            "C:/paper.pdf",
            "a\\b",
            "a//b",
            "a/CON.txt",
            "a/file.",
            "a/file ",
            "a/x?",
            "a/*.png",
            "a/<b>",
            "a/\"b",
            "a/|b",
        ] {
            assert!(!portable_resource_name(path), "{path}");
        }
        assert!(portable_resource_name("images/图1.jpg"));
    }
    #[test]
    fn resource_names_are_unique_on_case_insensitive_clients() {
        let resource = Resource {
            name: "images/a.png".into(),
            hash: "a".repeat(64),
            size: 3,
        };
        let mut document = EntityDocument {
            schema_version: 1,
            entity_id: "n".into(),
            kind: ObjectKind::Note,
            payload: serde_json::json!({}),
            resources: vec![resource.clone()],
            references: vec![],
        };
        assert!(document.validate().is_ok());
        document.resources.push(Resource {
            name: "IMAGES/A.PNG".into(),
            ..resource
        });
        assert!(document.validate().is_err());
    }
}
