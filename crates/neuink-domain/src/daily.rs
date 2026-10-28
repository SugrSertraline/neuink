use crate::NoteTarget;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DailyWidget {
    pub id: String,
    pub kind: WidgetKind,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub expanded: bool,
    #[serde(default)]
    pub note: Option<NoteTarget>,
    #[serde(default = "default_list")]
    pub list_id: String,
    #[serde(default)]
    pub selected_date_only: bool,
    #[serde(default)]
    pub show_completed: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum WidgetKind {
    Note,
    Todos,
    Journal,
    Entertainment,
    Recommendations,
}
pub fn default_list() -> String {
    "inbox".into()
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TodoList {
    pub id: String,
    pub title: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DailyTodo {
    pub id: String,
    pub list_id: String,
    pub text: String,
    pub date: Option<String>,
    pub completed: bool,
    #[serde(default)]
    pub deleted: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct EntertainmentRecord {
    pub id: String,
    pub date: String,
    pub started_at: String,
    pub ended_at: String,
    pub timezone_offset_minutes: i32,
    pub active_ms: u64,
    pub category: String,
    pub note: String,
    #[serde(default)]
    pub deleted: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EntertainmentTimer {
    pub id: String,
    pub category: String,
    pub note: String,
    pub running: bool,
    pub checkpoint_at: String,
    pub timezone_offset_minutes: i32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct EntertainmentState {
    pub version: u16,
    pub records: Vec<EntertainmentRecord>,
    pub timer: Option<EntertainmentTimer>,
}
impl Default for EntertainmentState {
    fn default() -> Self {
        Self {
            version: 1,
            records: vec![],
            timer: None,
        }
    }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RecommendationPreferences {
    pub interests: Vec<String>,
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DailyState {
    pub version: u16,
    pub widgets: Vec<DailyWidget>,
    pub lists: Vec<TodoList>,
    pub todos: Vec<DailyTodo>,
    pub recommendation_preferences: RecommendationPreferences,
}
impl Default for DailyState {
    fn default() -> Self {
        Self {
            version: 1,
            widgets: [WidgetKind::Note, WidgetKind::Todos, WidgetKind::Journal]
                .into_iter()
                .enumerate()
                .map(|(i, kind)| DailyWidget {
                    id: format!("default-{i}"),
                    kind,
                    title: String::new(),
                    collapsed: false,
                    expanded: false,
                    note: None,
                    list_id: default_list(),
                    selected_date_only: false,
                    show_completed: false,
                })
                .collect(),
            lists: vec![TodoList {
                id: default_list(),
                title: "我的待办".into(),
            }],
            todos: vec![],
            recommendation_preferences: RecommendationPreferences::default(),
        }
    }
}
