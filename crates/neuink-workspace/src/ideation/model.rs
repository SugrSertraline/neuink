use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationState {
    pub version: u32,
    #[serde(default)]
    pub boards: Vec<IdeationBoard>,
    pub cards: Vec<IdeationCard>,
    pub placements: Vec<IdeationPlacement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<IdeationLink>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationLink {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<IdeationSource>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationDraftRelation {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub sources: Vec<IdeationSource>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationCard {
    pub id: String,
    pub entry_id: String,
    pub title: String,
    pub body: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pattern_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sources: Vec<IdeationSource>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationSource {
    pub segment_uid: String,
    pub page_idx: u32,
    pub quote: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationPlacement {
    pub id: String,
    pub card_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub board_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub locked: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct IdeationSnapshot {
    pub revision: String,
    pub state: IdeationState,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationDraft {
    pub entry_id: String,
    pub status: String,
    pub cards: Vec<IdeationCard>,
    pub partial: bool,
    pub model: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub relations: Vec<IdeationDraftRelation>,
}

#[derive(Clone, Debug, Serialize)]
pub struct IdeationDraftSnapshot {
    pub revision: String,
    pub draft: Option<IdeationDraft>,
}

#[derive(Clone, Debug, Serialize)]
pub struct IdeationDraftSummary {
    pub entry_id: String,
    pub status: String,
    pub count: usize,
    pub partial: bool,
    pub revision: String,
    pub card_ids: Vec<String>,
    pub cards: Vec<IdeationDraftCardPreview>,
    pub error_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct IdeationDraftCardPreview {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub body: String,
    pub pattern_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationBoard {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewport: Option<IdeationViewport>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IdeationViewport {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}
fn is_false(value: &bool) -> bool {
    !value
}

/// Convert in memory only. The original bytes remain untouched until an explicit save.
pub(super) fn migrate(mut state: IdeationState) -> IdeationState {
    if state.version == 1 {
        state.version = 2;
        state.boards = vec![IdeationBoard {
            id: "legacy-board".into(),
            title: "已有构思".into(),
            description: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
            deleted_at: None,
            viewport: None,
        }];
        for (index, node) in state.placements.iter_mut().enumerate() {
            node.board_id = Some("legacy-board".into());
            if let Some(slot) = node.slot.take() {
                node.x = if slot == "problem" { 70.0 } else { 420.0 };
                node.y = (70.0 + index as f64 * 150.0).min(10000.0);
            }
        }
    }
    state
}
