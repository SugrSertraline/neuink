use std::collections::BTreeMap;

/// Canonical display fields for known import providers. Unrecognised custom keys are preserved.
pub const FIELD_ALIASES: &[(&str, &str)] = &[
    ("authors", "作者"), ("author", "作者"), ("year", "发表年份"), ("doi", "DOI"),
    ("publicationTitle", "期刊／会议名称"), ("发表载体", "期刊／会议名称"),
    ("publisher", "出版社"), ("volume", "卷号"), ("issue", "期号"), ("pages", "页码"),
    ("language", "语言"), ("date", "原始发表日期"), ("source_url", "来源链接"),
    ("pdf_source_url", "PDF 来源"), ("research_id", "检索文献 ID"),
    ("zotero_editor", "编辑"), ("zotero_translator", "译者"), ("abstract", "description"),
];

/// Conflicts are deliberately left as separate keys, never discarded or silently merged.
pub fn normalize_entry_fields(fields: &mut BTreeMap<String, String>) -> bool {
    let mut changed = false;
    for &(source, target) in FIELD_ALIASES {
        let Some(value) = fields.get(source).cloned() else { continue };
        match fields.get(target) {
            Some(existing) if !existing.trim().is_empty() && !value.trim().is_empty() && existing.trim() != value.trim() => continue,
            Some(existing) if !existing.trim().is_empty() => { fields.remove(source); }
            _ => { fields.insert(target.to_owned(), value); fields.remove(source); }
        }
        changed = true;
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn maps_known_keys_and_preserves_conflicting_and_custom_values() {
        let mut fields = BTreeMap::from([("authors".into(), "Ada".into()), ("year".into(), "2024".into()), ("doi".into(), "10.1/a".into()), ("DOI".into(), "10.1/b".into()), ("custom".into(), "keep".into())]);
        assert!(normalize_entry_fields(&mut fields));
        assert_eq!(fields["作者"], "Ada"); assert_eq!(fields["发表年份"], "2024");
        assert_eq!(fields["doi"], "10.1/a"); assert_eq!(fields["DOI"], "10.1/b"); assert_eq!(fields["custom"], "keep");
        assert!(!normalize_entry_fields(&mut fields));
    }
}
