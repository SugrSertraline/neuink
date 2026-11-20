use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use crate::{Workspace, WorkspaceError};

/// Field names are also the keys in legacy EntryMeta.fields; they cannot be renamed
/// until an atomic migration covering live and trashed entries exists.
#[derive(Clone, Debug, Deserialize, Serialize, Eq, PartialEq)]
pub struct FieldDefinition {
    pub name: String,
    pub kind: FieldKind,
    #[serde(default)]
    pub options: Vec<String>,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date_precision: Option<DatePrecision>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DatePrecision { Year, Month, Day }

#[derive(Clone, Copy, Debug, Deserialize, Serialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FieldKind { Text, Number, Date, Select, MultiSelect, Boolean }

fn default_definitions() -> Vec<FieldDefinition> {
    use FieldKind::*;
    [
        ("出版类型", Select, vec!["期刊", "会议", "预印本", "学位论文", "其他"]),
        ("期刊／会议名称", Text, vec![]), ("发表年份", Date, vec![]), ("DOI", Text, vec![]),
        ("发表日期", Date, vec![]), ("卷号", Text, vec![]), ("期号", Text, vec![]), ("页码", Text, vec![]),
        ("作者", Text, vec![]), ("引用次数", Number, vec![]), ("高影响力引用次数", Number, vec![]), ("研究主题", Text, vec![]), ("研究领域", Text, vec![]), ("语言", Text, vec![]), ("编辑", Text, vec![]), ("译者", Text, vec![]),
        ("来源平台", Text, vec![]), ("Sciverse 文档 ID", Text, vec![]), ("开放获取链接", Text, vec![]), ("开放获取许可", Text, vec![]), ("PDF 获取方式", Text, vec![]),
        ("来源链接", Text, vec![]), ("PDF 来源", Text, vec![]), ("检索文献 ID", Text, vec![]), ("原始发表日期", Text, vec![]),
        ("出版社", Text, vec![]), ("ISBN", Text, vec![]), ("ISSN", Text, vec![]), ("论文链接", Text, vec![]),
        ("开放获取", Boolean, vec![]), ("研究方法", Text, vec![]), ("研究对象", Text, vec![]), ("资助项目", Text, vec![]),
        ("收录情况", MultiSelect, vec!["SCI", "EI"]), ("JCR 分区", Select, vec!["Q1", "Q2", "Q3", "Q4"]),
        ("CCF 等级", Select, vec!["A", "B", "C"]), ("评价年份", Number, vec![]), ("评价来源", Text, vec![]),
    ].into_iter().map(|(name, kind, options)| FieldDefinition {
        name: name.into(), kind, options: options.into_iter().map(str::to_string).collect(), hidden: false, date_precision: if name == "发表年份" { Some(DatePrecision::Year) } else { None },
    }).collect()
}

pub fn validate(definitions: &[FieldDefinition]) -> Result<(), WorkspaceError> {
    let invalid = |message: &str| WorkspaceError::FieldDefinitions(message.into());
    if definitions.len() > 256 { return Err(invalid("属性数量不能超过 256")); }
    let mut names = HashSet::new();
    for field in definitions {
        if field.name.is_empty() || field.name.trim() != field.name || field.name.chars().count() > 100
            || field.name.chars().any(char::is_control) || field.name.eq_ignore_ascii_case("title")
            || field.name.eq_ignore_ascii_case("description") || field.name == "描述"
            || !names.insert(field.name.to_lowercase()) {
            return Err(invalid("属性名称无效或重复"));
        }
        if field.kind != FieldKind::Date && field.date_precision.is_some() { return Err(invalid("日期精度仅适用于日期属性")); }
        let selectable = matches!(field.kind, FieldKind::Select | FieldKind::MultiSelect);
        if field.options.len() > 256 || (!selectable && !field.options.is_empty()) {
            return Err(invalid("属性选项无效"));
        }
        let mut options = HashSet::new();
        for option in &field.options {
            if option.is_empty() || option.trim() != option || option.chars().count() > 100
                || option.chars().any(char::is_control) || !options.insert(option.to_lowercase()) {
                return Err(invalid("属性选项为空、过长或重复"));
            }
        }
    }
    Ok(())
}

impl Workspace {
    fn read_field_definitions_locked(&self) -> Result<Vec<FieldDefinition>, WorkspaceError> {
        let path = self.layout().root().join("field-definitions.json");
        match std::fs::symlink_metadata(&path) {
            Ok(meta) if !meta.file_type().is_file() => return Err(WorkspaceError::FieldDefinitions("属性配置路径无效".into())),
            Ok(meta) if meta.len() > 1024 * 1024 => return Err(WorkspaceError::FieldDefinitions("属性配置文件过大".into())),
            Ok(_) => {},
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(default_definitions()),
            Err(error) => return Err(error.into()),
        }
        let mut definitions: Vec<FieldDefinition> = serde_json::from_slice(&std::fs::read(path)?)?;
        for field in &mut definitions {
            if field.name == "发表年份" && field.kind == FieldKind::Number {
                field.kind = FieldKind::Date;
                field.date_precision = Some(DatePrecision::Year);
            }
        }
        validate(&definitions)?;
        for preset in default_definitions() {
            if !definitions.iter().any(|item| item.name.to_lowercase() == preset.name.to_lowercase()) { definitions.push(preset); }
        }
        Ok(definitions)
    }

    pub fn read_field_definitions(&self) -> Result<Vec<FieldDefinition>, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_field_definitions_locked()
    }

    /// Update one value under the same lock as metadata and definition edits.
    pub fn update_entry_field(&self, entry_id: &neuink_domain::EntryId, definition: &FieldDefinition, expected: Option<&str>, value: Option<&str>) -> Result<neuink_domain::EntryMeta, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        if crate::entry_sources::is_source_managed_dir(&self.layout().entry_dir(entry_id))? { return Err(WorkspaceError::SourceManagedEntry); }
        let definitions = self.read_field_definitions_locked()?;
        if !definitions.iter().any(|current| current == definition && !current.hidden) {
            return Err(WorkspaceError::FieldDefinitions("属性配置已更改，请关闭编辑并重新打开".into()));
        }
        let mut entry = self.read_entry(entry_id)?;
        if entry.fields.get(&definition.name).map(String::as_str) != expected {
            return Err(WorkspaceError::FieldDefinitions("该属性已在其他位置修改，请关闭编辑并重新打开".into()));
        }
        let value = value.map(str::trim).filter(|value| !value.is_empty());
        if let Some(value) = value {
            let valid = match definition.kind {
                FieldKind::Text => true,
                FieldKind::Number => value.parse::<f64>().is_ok_and(f64::is_finite),
                FieldKind::Boolean => matches!(value, "是" | "否" | "true" | "false"),
                FieldKind::Select => definition.options.iter().any(|item| item == value),
                FieldKind::MultiSelect => {
                    let previous = expected.and_then(|v| serde_json::from_str::<Vec<String>>(v).ok()).unwrap_or_default();
                    serde_json::from_str::<Vec<String>>(value).is_ok_and(|items| !items.is_empty() && items.iter().all(|item| definition.options.contains(item) || previous.contains(item)))
                },
                FieldKind::Date => match definition.date_precision.unwrap_or(DatePrecision::Day) {
                    DatePrecision::Year => value.len() == 4 && value.bytes().all(|c| c.is_ascii_digit()),
                    DatePrecision::Month => value.len() == 7 && chrono::NaiveDate::parse_from_str(&format!("{value}-01"), "%Y-%m-%d").is_ok(),
                    DatePrecision::Day => value.len() == 10 && chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok(),
                },
            };
            if !valid { return Err(WorkspaceError::FieldDefinitions("属性值不符合类型或可选项要求".into())); }
            entry.fields.insert(definition.name.clone(), value.to_owned());
        } else { entry.fields.remove(&definition.name); }
        entry.updated_at = chrono::Utc::now();
        entry.validate()?;
        crate::atomic_write_json(self.layout().entry_meta_file(entry_id), &entry)?;
        Ok(entry)
    }

    /// Compare-and-swap prevents simultaneous settings edits overwriting each other.
    pub fn save_field_definitions(&self, expected: &[FieldDefinition], definitions: Vec<FieldDefinition>) -> Result<Vec<FieldDefinition>, WorkspaceError> {
        self.save_field_definitions_with_rename(expected, definitions, None)
    }

    pub fn save_field_definitions_with_rename(&self, expected: &[FieldDefinition], definitions: Vec<FieldDefinition>, rename: Option<(String, String)>) -> Result<Vec<FieldDefinition>, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        let current = self.read_field_definitions_locked()?;
        if current != expected {
            return Err(WorkspaceError::FieldDefinitions("属性配置已在其他位置修改，请重新读取".into()));
        }
        validate(&definitions)?;
        let entries = self.list_entries()?.into_iter().chain(self.list_trashed_entries()?).collect::<Vec<_>>();
        if let Some((ref from, ref to)) = rename {
            let Some(old) = current.iter().find(|item| item.name == *from && !item.hidden) else { return Err(WorkspaceError::FieldDefinitions("原属性不存在".into())); };
            if current.iter().any(|item| item.name.eq_ignore_ascii_case(to)) || !definitions.iter().any(|item| item.name == *to && !item.hidden) || !definitions.iter().any(|item| item.name == old.name && item.hidden) {
                return Err(WorkspaceError::FieldDefinitions("属性重命名无效或名称已存在".into()));
            }
            if entries.iter().any(|entry| [from, to].iter().any(|name| entry.fields.get(*name).is_some_and(|value| !value.trim().is_empty()))) {
                return Err(WorkspaceError::FieldDefinitions("属性名称已有条目数据，不能重命名".into()));
            }
        }
        for old in &current {
            let Some(new) = definitions.iter().find(|item| item.name == old.name) else {
                return Err(WorkspaceError::FieldDefinitions("暂不支持删除或重命名属性，请隐藏属性".into()));
            };
            let values: Vec<&str> = entries.iter().filter_map(|entry| entry.fields.get(&old.name)).map(String::as_str).filter(|value| !value.trim().is_empty()).collect();
            if (new.kind != old.kind || (new.kind == FieldKind::Date && new.date_precision.unwrap_or(DatePrecision::Day) != old.date_precision.unwrap_or(DatePrecision::Day))) && !values.is_empty() {
                return Err(WorkspaceError::FieldDefinitions(format!("属性“{}”已有条目填写，不能更改类型", old.name)));
            }
            let removed = old.options.iter().filter(|option| !new.options.contains(option)).collect::<Vec<_>>();
            if !removed.is_empty() && new.kind == old.kind {
                for value in values {
                    let used = if old.kind == FieldKind::MultiSelect {
                        match serde_json::from_str::<Vec<String>>(value) {
                            Ok(selected) => removed.iter().any(|option| selected.contains(option)),
                            Err(_) => true,
                        }
                    } else { removed.iter().any(|option| option.as_str() == value) };
                    if used { return Err(WorkspaceError::FieldDefinitions(format!("属性“{}”的选项已被条目使用，不能删除或修改", old.name))); }
                }
            }
        }
        crate::atomic_write_json(self.layout().root().join("field-definitions.json"), &definitions)?;
        Ok(definitions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn definition() -> FieldDefinition {
        FieldDefinition { name: "JCR 分区".into(), kind: FieldKind::Select,
            options: vec!["Q1".into(), "Q2".into()], hidden: false, date_precision: None }
    }

    #[test]
    fn definitions_survive_restart_and_reject_stale_or_destructive_edits() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace::create(temp.path()).unwrap();
        let defaults = ws.read_field_definitions().unwrap();
        assert!(defaults.iter().any(|field| field.name == "DOI"));
        let mut first = defaults.clone();
        first.push(FieldDefinition { name: "测试属性".into(), ..definition() });
        ws.save_field_definitions(&defaults, first.clone()).unwrap();
        let reopened = Workspace::open_existing(temp.path()).unwrap();
        assert_eq!(reopened.read_field_definitions().unwrap(), first);
        reopened.create_tag("测试标签", None).unwrap();
        assert_eq!(reopened.read_field_definitions().unwrap(), first);
        assert!(reopened.save_field_definitions(&[], vec![]).is_err());
        assert!(reopened.save_field_definitions(&first, vec![]).is_err());
        let mut changed = first.clone(); changed.last_mut().unwrap().options.pop();
        assert!(reopened.save_field_definitions(&first, changed.clone()).is_ok());
        reopened.save_field_definitions(&changed, first.clone()).unwrap();
        let mut changed = first.clone(); changed.last_mut().unwrap().kind = FieldKind::Text; changed.last_mut().unwrap().options.clear();
        assert!(reopened.save_field_definitions(&first, changed.clone()).is_ok());
        reopened.save_field_definitions(&changed, first.clone()).unwrap();
        let mut changed = first.clone(); changed.last_mut().unwrap().hidden = true; changed.last_mut().unwrap().options.push("Q3".into());
        assert_eq!(reopened.save_field_definitions(&first, changed.clone()).unwrap(), changed);
    }

    #[test]
    fn used_values_and_trashed_entries_block_destructive_edits() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace::create(temp.path()).unwrap();
        let original = ws.read_field_definitions().unwrap();
        let mut fields = std::collections::BTreeMap::new();
        fields.insert("JCR 分区".to_string(), "Q1".to_string());
        let entry = ws.create_entry_with_meta("测试", fields, vec![]).unwrap();
        ws.delete_entry(&entry.id).unwrap();
        let mut without_used = original.clone();
        without_used.iter_mut().find(|f| f.name == "JCR 分区").unwrap().options.retain(|v| v != "Q1");
        assert!(ws.save_field_definitions(&original, without_used).is_err());
        let mut changed_type = original.clone();
        let item = changed_type.iter_mut().find(|f| f.name == "JCR 分区").unwrap();
        item.kind = FieldKind::Text; item.options.clear();
        assert!(ws.save_field_definitions(&original, changed_type).is_err());
        let mut renamed = original.clone();
        let original_field = renamed.iter_mut().find(|f| f.name == "JCR 分区").unwrap();
        let mut replacement = original_field.clone(); original_field.hidden = true; replacement.name = "我的分区".into(); renamed.push(replacement);
        assert!(ws.save_field_definitions_with_rename(&original, renamed, Some(("JCR 分区".into(), "我的分区".into()))).is_err());
        let mut reordered = original.clone();
        reordered.iter_mut().find(|f| f.name == "JCR 分区").unwrap().options.reverse();
        assert!(ws.save_field_definitions(&original, reordered).is_ok());
    }

    #[test]
    fn legacy_publication_year_is_year_precision_and_data_is_preserved() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace::create(temp.path()).unwrap();
        let mut old = default_definitions();
        let year = old.iter_mut().find(|f| f.name == "发表年份").unwrap();
        year.kind = FieldKind::Number; year.date_precision = None;
        crate::atomic_write_json(ws.layout().root().join("field-definitions.json"), &old).unwrap();
        let mut fields = std::collections::BTreeMap::new(); fields.insert("发表年份".into(), "2024".into());
        let entry = ws.create_entry_with_meta("测试", fields, vec![]).unwrap();
        let migrated = ws.read_field_definitions().unwrap();
        let year = migrated.iter().find(|f| f.name == "发表年份").unwrap();
        assert_eq!(year.kind, FieldKind::Date); assert_eq!(year.date_precision, Some(DatePrecision::Year));
        assert_eq!(ws.list_entries().unwrap().into_iter().find(|item| item.id == entry.id).unwrap().fields["发表年份"], "2024");
        let mut changed = migrated.clone(); changed.iter_mut().find(|f| f.name == "发表年份").unwrap().date_precision = Some(DatePrecision::Month);
        assert!(ws.save_field_definitions(&migrated, changed).is_err());
        assert!(ws.save_field_definitions(&migrated, migrated.clone()).is_ok());
    }

    #[test]
    fn existing_definitions_gain_missing_defaults_without_restoring_hidden_items() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace::create(temp.path()).unwrap();
        let mut old = default_definitions();
        old.retain(|field| field.name != "发表日期" && field.name != "研究方法");
        old.iter_mut().find(|field| field.name == "DOI").unwrap().hidden = true;
        crate::atomic_write_json(ws.layout().root().join("field-definitions.json"), &old).unwrap();
        let loaded = ws.read_field_definitions().unwrap();
        assert!(loaded.iter().any(|field| field.name == "发表日期" && !field.hidden));
        assert!(loaded.iter().any(|field| field.name == "研究方法" && !field.hidden));
        assert!(loaded.iter().find(|field| field.name == "DOI").unwrap().hidden);
        assert!(ws.save_field_definitions(&loaded, loaded.clone()).is_ok());
    }

    #[test]
    fn duplicate_names_and_invalid_options_are_rejected() {
        let mut duplicate = definition(); duplicate.name = "jcr 分区".into();
        assert!(validate(&[definition(), duplicate]).is_err());
        let mut invalid = definition(); invalid.options.push("Q1".into());
        assert!(validate(&[invalid]).is_err());
        let mut invalid = definition(); invalid.name = "title".into();
        assert!(validate(&[invalid]).is_err());
        let mut invalid = definition(); invalid.name = "description".into();
        assert!(validate(&[invalid]).is_err());
        let mut invalid = definition(); invalid.name = "描述".into();
        assert!(validate(&[invalid]).is_err());
    }

    #[test]
    fn removed_default_stays_hidden_after_reopen_and_can_be_restored() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace::create(temp.path()).unwrap();
        let initial = ws.read_field_definitions().unwrap();
        let mut hidden = initial.clone();
        hidden.iter_mut().find(|field| field.name == "DOI").unwrap().hidden = true;
        ws.save_field_definitions(&initial, hidden.clone()).unwrap();
        let reopened = Workspace::open_existing(temp.path()).unwrap();
        assert!(reopened.read_field_definitions().unwrap().iter().find(|field| field.name == "DOI").unwrap().hidden);
        let mut restored = hidden.clone();
        restored.iter_mut().find(|field| field.name == "DOI").unwrap().hidden = false;
        reopened.save_field_definitions(&hidden, restored.clone()).unwrap();
        assert_eq!(reopened.read_field_definitions().unwrap(), restored);
    }
    #[test]
    fn inline_field_update_preserves_other_changes_and_rejects_stale_or_invalid_values() {
        let temp = tempfile::tempdir().unwrap();
        let ws = Workspace::create(temp.path()).unwrap();
        let mut fields = std::collections::BTreeMap::new();
        fields.insert("DOI".to_string(), "10.1/test".to_string());
        let entry = ws.create_entry_with_meta("Paper", fields, vec![]).unwrap();
        let def = ws.read_field_definitions().unwrap().into_iter().find(|d| d.name == "CCF 等级").unwrap();
        let changed = ws.update_entry_field(&entry.id, &def, None, Some("A")).unwrap();
        assert_eq!(changed.fields["DOI"], "10.1/test");
        assert_eq!(changed.fields["CCF 等级"], "A");
        assert!(ws.update_entry_field(&entry.id, &def, None, Some("B")).is_err());
        assert!(ws.update_entry_field(&entry.id, &def, Some("A"), Some("X")).is_err());
        assert_eq!(ws.read_entry(&entry.id).unwrap().fields["CCF 等级"], "A");
        let cleared = ws.update_entry_field(&entry.id, &def, Some("A"), None).unwrap();
        assert!(!cleared.fields.contains_key("CCF 等级"));
        assert_eq!(cleared.fields["DOI"], "10.1/test");
    }

}
