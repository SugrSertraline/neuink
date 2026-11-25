use std::collections::BTreeMap;
use base64::{Engine, engine::general_purpose::STANDARD};
use neuink_workspace::{Workspace, edit_recovery::EditRecoveryDraft};

pub(super) trait Vault {
    fn put(&self, account: &str, value: &str) -> Result<(), String>;
    fn get(&self, account: &str) -> Result<String, String>;
    fn delete(&self, account: &str) -> Result<(), String>;
}
pub(super) struct SystemVault;
fn credential(account: &str) -> Result<keyring::Entry, String> {
    if !matches!(keyring::default::default_credential_builder().persistence(), keyring::credential::CredentialPersistence::UntilDelete) {
        return Err("此构建未启用持久系统凭据库，不能备份密钥".into());
    }
    keyring::Entry::new("com.neuink.edit-recovery", account).map_err(|_| "无法打开安全草稿凭据库".into())
}
impl Vault for SystemVault {
    fn put(&self, account: &str, value: &str) -> Result<(), String> { credential(account)?.set_password(value).map_err(|_| "密钥草稿安全写入失败".into()) }
    fn get(&self, account: &str) -> Result<String, String> { credential(account)?.get_password().map_err(|_| "无法读取密钥草稿，请在原电脑登录原账户后重试".into()) }
    fn delete(&self, account: &str) -> Result<(), String> {
        match credential(account)?.delete_credential() { Ok(()) | Err(keyring::Error::NoEntry) => Ok(()), Err(_) => Err("安全草稿清理失败，请重试".into()) }
    }
}
fn prefix(workspace: &Workspace, key: &str) -> Result<String, String> {
    let root = workspace.layout().root().canonicalize().map_err(|_| "无法定位恢复目录")?;
    Ok(blake3::hash(format!("{}\0{}", root.to_string_lossy(), key).as_bytes()).to_hex().to_string())
}
fn find(workspace: &Workspace, key: &str) -> Result<Option<EditRecoveryDraft>, String> {
    Ok(workspace.read_edit_recovery().map_err(|e| e.to_string())?.drafts.into_iter().find(|draft| draft.key == key))
}
fn accounts(prefix: &str, reference: &str) -> Result<Vec<String>, String> {
    let (hash, count) = reference.split_once(':').ok_or("安全草稿引用无效")?;
    let count: usize = count.parse().map_err(|_| "安全草稿引用无效")?;
    if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) || !(1..=64).contains(&count) { return Err("安全草稿引用无效".into()); }
    Ok((0..count).map(|index| format!("{prefix}:{hash}:{index}")).collect())
}
fn clear(vault: &impl Vault, prefix: &str, reference: Option<&str>) -> Result<(), String> {
    if let Some(reference) = reference { for account in accounts(prefix, reference)? { vault.delete(&account)?; } }
    Ok(())
}
pub(super) fn write(workspace: &Workspace, mut draft: EditRecoveryDraft, secrets: BTreeMap<String, String>, vault: &impl Vault) -> Result<(), String> {
    let prefix = prefix(workspace, &draft.key)?;
    let previous = find(workspace, &draft.key)?;
    // The caller cannot supply a credential reference. Only separately supplied fields enter the vault.
    draft.secret_ref = None;
    let mut stored: Vec<String> = Vec::new();
    if !secrets.is_empty() {
        let bytes = serde_json::to_vec(&secrets).map_err(|_| "密钥草稿格式无效")?;
        if bytes.len() > 64 * 1024 || secrets.len() > 32 { return Err("密钥草稿超出大小限制".into()); }
        let encoded = STANDARD.encode(bytes);
        // Below the Windows credential blob limit, including UTF-16 password encoding.
        let chunks: Vec<_> = encoded.as_bytes().chunks(1000).collect();
        if chunks.len() > 64 { return Err("密钥草稿超出大小限制".into()); }
        let reference = format!("{}:{}", blake3::hash(format!("{}\0{encoded}", draft.updated_at).as_bytes()), chunks.len());
        for (account, chunk) in accounts(&prefix, &reference)?.into_iter().zip(chunks) {
            let text = std::str::from_utf8(chunk).map_err(|_| "密钥草稿编码失败")?;
            if let Err(error) = vault.put(&account, text) {
                if previous.as_ref().and_then(|d| d.secret_ref.as_ref()) != Some(&reference) { for prior in stored { let _ = vault.delete(&prior); } }
                return Err(error);
            }
            stored.push(account);
        }
        draft.secret_ref = Some(reference);
    }
    if let Err(error) = workspace.write_edit_recovery(&draft) {
        if previous.as_ref().and_then(|d| d.secret_ref.as_ref()) != draft.secret_ref.as_ref() { for account in stored { let _ = vault.delete(&account); } }
        return Err(error.to_string());
    }
    if let Some(previous) = previous.filter(|old| old.secret_ref != draft.secret_ref) { clear(vault, &prefix, previous.secret_ref.as_deref())?; }
    Ok(())
}
pub(super) fn read(workspace: &Workspace, key: &str, expected_ref: Option<&str>, vault: &impl Vault) -> Result<BTreeMap<String, String>, String> {
    let draft = find(workspace, key)?.ok_or("草稿不存在")?;
    if expected_ref.is_some() && draft.secret_ref.as_deref() != expected_ref { return Err("恢复草稿已更新，请重新打开对应页面".into()); }
    let Some(reference) = draft.secret_ref else { return Ok(BTreeMap::new()); };
    let mut encoded = String::new();
    for account in accounts(&prefix(workspace, key)?, &reference)? { encoded.push_str(&vault.get(&account)?); }
    serde_json::from_slice(&STANDARD.decode(encoded).map_err(|_| "安全草稿格式无效")?).map_err(|_| "安全草稿格式无效".into())
}
pub(super) fn remove(workspace: &Workspace, key: &str, vault: &impl Vault) -> Result<(), String> {
    if let Some(draft) = find(workspace, key)? { clear(vault, &prefix(workspace, key)?, draft.secret_ref.as_deref())?; }
    workspace.remove_edit_recovery(key).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    #[derive(Default)] struct MemoryVault(RefCell<BTreeMap<String, String>>, bool);
    impl Vault for MemoryVault {
        fn put(&self, a: &str, v: &str) -> Result<(), String> { if self.1 { return Err("vault unavailable".into()); } self.0.borrow_mut().insert(a.into(), v.into()); Ok(()) }
        fn get(&self, a: &str) -> Result<String, String> { self.0.borrow().get(a).cloned().ok_or("missing".into()) }
        fn delete(&self, a: &str) -> Result<(), String> { self.0.borrow_mut().remove(a); Ok(()) }
    }
    #[test] fn secrets_roundtrip_separate_from_disk_and_cleanup() {
        let dir = tempfile::tempdir().unwrap(); let ws = Workspace::open(dir.path()).unwrap(); let vault = MemoryVault::default();
        let draft = EditRecoveryDraft { key: "settings:key".into(), kind: neuink_workspace::edit_recovery::DraftKind::Settings,
            label: "翻译配置".into(), owner_id: "settings".into(), target_id: "translation-sources".into(), scope_key: "settings".into(),
            updated_at: "2026-11-04T13:00:00Z".into(), payload: serde_json::json!({"value":{"endpoint":"https://example.com"}}), secret_ref: None };
        let secrets = BTreeMap::from([("apiKey".into(), "private-test-key".repeat(400))]);
        write(&ws, draft.clone(), secrets.clone(), &vault).unwrap();
        let records = ws.read_edit_recovery().unwrap();
        assert!(!serde_json::to_string(&records).unwrap().contains("private-test-key"));
        assert!(records.drafts[0].secret_ref.is_some()); assert_eq!(read(&ws, &draft.key, None, &vault).unwrap(), secrets);
        assert!(read(&ws, &draft.key, Some("stale-reference"), &vault).is_err());
        let other_dir = tempfile::tempdir().unwrap(); let other = Workspace::open(other_dir.path()).unwrap();
        other.write_edit_recovery(&records.drafts[0]).unwrap();
        assert!(read(&other, &draft.key, None, &vault).is_err());
        assert!(write(&ws, draft.clone(), BTreeMap::from([("apiKey".into(), "replacement".into())]), &MemoryVault(RefCell::default(), true)).is_err());
        assert_eq!(read(&ws, &draft.key, None, &vault).unwrap(), secrets);
        write(&ws, draft.clone(), BTreeMap::from([("apiKey".into(), "new".into())]), &vault).unwrap();
        assert_eq!(vault.0.borrow().len(), 1);
        remove(&ws, &draft.key, &vault).unwrap(); assert!(vault.0.borrow().is_empty()); assert!(ws.read_edit_recovery().unwrap().drafts.is_empty());
    }
    #[test]
    #[ignore = "Uses a temporary synthetic credential in the actual OS vault, then deletes it"]
    fn system_vault_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        let account = format!("validation:{}", blake3::hash(dir.path().to_string_lossy().as_bytes()));
        SystemVault.put(&account, "synthetic-recovery-check").unwrap();
        let read = SystemVault.get(&account);
        let deleted = SystemVault.delete(&account);
        assert_eq!(read.unwrap(), "synthetic-recovery-check"); deleted.unwrap();
        assert!(SystemVault.get(&account).is_err());
    }
}
