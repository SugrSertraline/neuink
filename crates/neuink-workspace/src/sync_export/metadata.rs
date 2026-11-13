//! Preserve reader semantics, not arbitrary provider response/configuration data.
use super::{
    decode, invalid,
    references::{host_path, validate_bbox},
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, io};

#[derive(Deserialize, Serialize)]
pub(super) struct ListItemRegion {
    pub bbox: [f32; 4],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_idx: Option<u32>,
    pub text: String,
}

pub(super) fn sanitize(metadata: &mut BTreeMap<String, String>) -> io::Result<bool> {
    let original = std::mem::take(metadata);
    let mut removed = false;
    for (key, value) in original {
        match key.as_str() {
            "list_item_regions" => {
                let regions: Vec<ListItemRegion> = decode(value.as_bytes())?;
                for region in &regions {
                    validate_bbox(region.bbox)?;
                }
                metadata.insert(
                    key,
                    serde_json::to_string(&regions).map_err(io::Error::other)?,
                );
            }
            "anchor" | "angle" | "index" | "sub_type" | "level" | "code_language" | "language"
            | "lang" | "table_type" | "table_nest_level" | "list_type" | "math_type"
            | "list_parent_uid" | "list_item_index" => {
                if value.len() > 512 || value.chars().any(char::is_control) || host_path(&value) {
                    return Err(invalid("解析阅读字段包含无效值或本机路径"));
                }
                metadata.insert(key, value);
            }
            _ => removed = true,
        }
    }
    Ok(removed)
}
