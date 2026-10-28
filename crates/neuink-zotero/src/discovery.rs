use crate::{SourceSettings, ZoteroError};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

pub fn normalize_directory(path: &Path) -> Result<PathBuf, ZoteroError> {
    let dir = if path.file_name().is_some_and(|v| v == "zotero.sqlite") {
        path.parent().ok_or(ZoteroError::Directory)?
    } else {
        path
    };
    if !dir.join("zotero.sqlite").is_file() {
        return Err(ZoteroError::Directory);
    }
    dir.canonicalize().map_err(|_| ZoteroError::Directory)
}

/// Parse only known preferences as data. Never execute prefs.js or enumerate a disk.
fn preferences(path: &Path) -> BTreeMap<String, serde_json::Value> {
    let mut found = BTreeMap::new();
    let Ok(meta) = fs::metadata(path) else {
        return found;
    };
    if meta.len() > 4 * 1024 * 1024 {
        return found;
    }
    let Ok(text) = fs::read_to_string(path) else {
        return found;
    };
    for line in text.lines() {
        let Some(body) = line
            .trim()
            .strip_prefix("user_pref(")
            .and_then(|s| s.strip_suffix(");"))
        else {
            continue;
        };
        let Ok(values) = serde_json::from_str::<Vec<serde_json::Value>>(&format!("[{body}]"))
        else {
            continue;
        };
        let [serde_json::Value::String(key), value] = values.as_slice() else {
            continue;
        };
        if [
            "extensions.zotero.dataDir",
            "extensions.zotero.useDataDir",
            "extensions.zotero.baseAttachmentPath",
        ]
        .contains(&key.as_str())
        {
            found.insert(key.clone(), value.clone());
        }
    }
    found
}

pub fn discover() -> Vec<SourceSettings> {
    let home =
        std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let profiles = if cfg!(windows) {
        std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("Zotero/Zotero"))
    } else if cfg!(target_os = "macos") {
        home.as_ref()
            .map(|p| p.join("Library/Application Support/Zotero"))
    } else {
        home.as_ref().map(|p| p.join(".zotero/zotero"))
    };
    discover_in(home.as_deref(), profiles.as_deref())
}

pub fn discover_in(home: Option<&Path>, profiles: Option<&Path>) -> Vec<SourceSettings> {
    let mut candidates = Vec::new();
    if let Some(profiles) = profiles {
        for path in profile_paths(profiles) {
            let prefs = preferences(&path.join("prefs.js"));
            let directory = if prefs
                .get("extensions.zotero.useDataDir")
                .and_then(|v| v.as_bool())
                == Some(true)
            {
                prefs
                    .get("extensions.zotero.dataDir")
                    .and_then(|v| v.as_str())
                    .map(PathBuf::from)
            } else {
                home.map(|p| p.join("Zotero"))
            };
            let linked = prefs
                .get("extensions.zotero.baseAttachmentPath")
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty())
                .map(PathBuf::from);
            if let Some(directory) = directory {
                push_candidate(&mut candidates, &directory, linked.clone());
            }
            push_candidate(&mut candidates, &path.join("zotero"), linked);
        }
    }
    if let Some(home) = home {
        push_candidate(&mut candidates, &home.join("Zotero"), None);
    }
    candidates
}

fn push_candidate(candidates: &mut Vec<SourceSettings>, directory: &Path, linked: Option<PathBuf>) {
    let Ok(directory) = normalize_directory(directory) else {
        return;
    };
    if candidates
        .iter()
        .any(|c| c.data_directory.as_ref() == Some(&directory))
    {
        return;
    }
    candidates.push(SourceSettings {
        data_directory: Some(directory),
        linked_attachment_directory: linked,
    });
}

fn profile_paths(root: &Path) -> Vec<PathBuf> {
    let Ok(text) = fs::read_to_string(root.join("profiles.ini")) else {
        return vec![];
    };
    if text.len() > 256 * 1024 {
        return vec![];
    }
    let mut sections: Vec<BTreeMap<&str, &str>> = Vec::new();
    for line in text.lines().map(str::trim) {
        if line.starts_with("[Profile") {
            sections.push(BTreeMap::new());
        } else if line.starts_with('[') {
            sections.push(BTreeMap::new());
        } else if let Some((key, value)) = line.split_once('=') {
            if let Some(section) = sections.last_mut() {
                section.insert(key, value);
            }
        }
    }
    sections.sort_by_key(|s| s.get("Default") != Some(&"1"));
    sections
        .into_iter()
        .filter_map(|s| {
            s.get("Path").map(|path| {
                if s.get("IsRelative") == Some(&"0") {
                    PathBuf::from(path)
                } else {
                    root.join(path)
                }
            })
        })
        .collect()
}
