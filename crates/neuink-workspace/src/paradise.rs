//! Optional campus game save, isolated from reading and library records.
use crate::{atomic_write_json, Workspace, WorkspaceError};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct ParadiseSave {
    pub revision: u64,
    pub world: Value,
}

impl Workspace {
    pub fn read_paradise(&self) -> Result<Option<ParadiseSave>, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        self.read_paradise_unlocked()
    }

    fn read_paradise_unlocked(&self) -> Result<Option<ParadiseSave>, WorkspaceError> {
        let path = self.layout().root().join("campus-travel.json");
        if !path.exists() {
            return Ok(None);
        }
        if std::fs::metadata(&path)?.len() > 1_100_000 {
            return Err(WorkspaceError::Paradise(
                "乐园存档过大，未覆盖原文件".into(),
            ));
        }
        let save: ParadiseSave = serde_json::from_slice(&std::fs::read(path)?)?;
        validate_world(&save.world)?;
        Ok(Some(save))
    }

    pub fn save_paradise(
        &self,
        expected_revision: u64,
        world: Value,
    ) -> Result<ParadiseSave, WorkspaceError> {
        let _guard = self.begin_tag_safe_mutation()?;
        validate_world(&world)?;
        if serde_json::to_vec(&world)?.len() > 1_000_000 {
            return Err(WorkspaceError::Paradise(
                "不支持的乐园存档或存档过大".into(),
            ));
        }
        let revision = self
            .read_paradise_unlocked()?
            .map_or(0, |save| save.revision);
        if revision != expected_revision {
            return Err(WorkspaceError::Paradise(
                "乐园已在其他窗口更新，请重新载入存档".into(),
            ));
        }
        let save = ParadiseSave {
            revision: revision
                .checked_add(1)
                .ok_or_else(|| WorkspaceError::Paradise("存档版本超出范围".into()))?,
            world,
        };
        atomic_write_json(self.layout().root().join("campus-travel.json"), &save)?;
        Ok(save)
    }
}

fn validate_world(world: &Value) -> Result<(), WorkspaceError> {
    let count = |v: &Value| v.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991);
    let gear = |v: &Value| matches!(v.as_str(), Some("camera" | "notebook" | "thermos"));
    let mut ids = std::collections::HashSet::new();
    let mut previous_return = 0;
    let valid = world["version"].as_u64() == Some(2)
        && world["name"].as_str().is_some_and(|s| !s.trim().is_empty() && s.chars().count() <= 40)
        && gear(&world["gear"]) && world["motion"].is_boolean()
        && (world.get("atmosphere").is_none() ||
            matches!(world["atmosphere"]["season"].as_str(),Some("auto"|"spring"|"summer"|"autumn"|"winter")) &&
            matches!(world["atmosphere"]["weather"].as_str(),Some("auto"|"sunny"|"cloudy"|"wind"|"rain"|"snow"|"fog")))
        && world["trips"].as_array().is_some_and(|trips| trips.len() <= 500 && trips.iter().all(|t| {
            let valid = t["id"].as_str().is_some_and(|id| !id.is_empty() && id.len() <= 100 && ids.insert(id.to_owned()))
                && ["startedAt", "mailAt", "returnsAt"].iter().all(|key| count(&t[*key]))
                && t["startedAt"].as_u64() >= Some(previous_return)
                && t["startedAt"].as_u64() < t["mailAt"].as_u64()
                && t["mailAt"].as_u64() < t["returnsAt"].as_u64()
                && gear(&t["gear"])
                && (t.get("destination").is_none() || matches!(t["destination"].as_str(), Some("trial" | "informatics" | "lake" | "teaching")))
                && t["read"].is_boolean() && t["collected"].is_boolean();
            previous_return = t["returnsAt"].as_u64().unwrap_or(0);
            valid
        }));
    if valid { Ok(()) } else {
        Err(WorkspaceError::Paradise("旅行存档格式不正确，原文件未被覆盖".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_duplicate_overlap_and_invalid_trip_fields() {
        let trip = serde_json::json!({"id":"one","startedAt":1000,"mailAt":31000,"returnsAt":61000,"gear":"camera","read":false,"collected":false});
        let base = serde_json::json!({"version":2,"name":"海豹","gear":"camera","motion":true,"trips":[trip.clone()]});
        assert!(validate_world(&base).is_ok());
        let mut climate=base.clone();climate["atmosphere"]=serde_json::json!({"season":"winter","weather":"snow"});
        assert!(validate_world(&climate).is_ok());
        for weather in ["auto", "cloudy", "wind", "fog", "rain", "snow", "sunny"] {
            climate["atmosphere"]["weather"]=serde_json::json!(weather);
            assert!(validate_world(&climate).is_ok());
        }
        climate["atmosphere"]["weather"]=serde_json::json!("bad");
        assert!(validate_world(&climate).is_err());
        climate["atmosphere"]=serde_json::Value::Null;
        assert!(validate_world(&climate).is_err());
        let mut routed=base.clone();routed["trips"][0]["destination"]=serde_json::json!("lake");
        assert!(validate_world(&routed).is_ok());
        routed["trips"][0]["destination"]=serde_json::json!("unknown");
        assert!(validate_world(&routed).is_err());
        for key in ["startedAt", "mailAt", "returnsAt"] {
            let mut invalid=base.clone();invalid["trips"][0][key]=serde_json::json!(-1);
            assert!(validate_world(&invalid).is_err());
        }
        let mut duplicate=base.clone();duplicate["trips"]=serde_json::json!([trip.clone(),trip.clone()]);
        assert!(validate_world(&duplicate).is_err());
        duplicate["trips"][1]["id"]=serde_json::json!("two");
        assert!(validate_world(&duplicate).is_err());
        let mut invalid=base.clone();invalid["gear"]=serde_json::json!("constructor");
        assert!(validate_world(&invalid).is_err());
    }
    #[test]
    fn saves_atomically_and_rejects_stale_or_corrupt_save() {
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("neuink-paradise-{suffix}"));
        let workspace = Workspace::create(&dir).unwrap();
        std::fs::write(dir.join("paradise.json"), b"old save remains untouched").unwrap();
        assert!(workspace.read_paradise().unwrap().is_none());
        let world = serde_json::json!({"version":2,"name":"小海豹","gear":"camera","motion":true,"trips":[]});
        assert!(workspace
            .save_paradise(0, serde_json::json!({"version":1}))
            .is_err());
        assert_eq!(
            workspace.save_paradise(0, world.clone()).unwrap().revision,
            1
        );
        assert!(workspace.save_paradise(0, world.clone()).is_err());
        assert_eq!(workspace.read_paradise().unwrap().unwrap().revision, 1);
        std::fs::write(dir.join("campus-travel.json"), b"broken").unwrap();
        assert!(workspace.save_paradise(1, world).is_err());
        assert_eq!(std::fs::read(dir.join("campus-travel.json")).unwrap(), b"broken");
        assert_eq!(std::fs::read(dir.join("paradise.json")).unwrap(), b"old save remains untouched");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
