use super::{invalid, model::*};
use crate::WorkspaceError;
use std::collections::{HashMap, HashSet};
pub(super) fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}
fn valid_segment_uid(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b':')
}
pub(super) fn validate(state: &IdeationState) -> Result<(), WorkspaceError> {
    if ![1, 2].contains(&state.version)
        || (state.version == 1 && !state.boards.is_empty())
        || state.boards.len() > 1000
        || state.cards.len() > 10_000
        || state.placements.len() > 5_000
        || state.links.len() > 10_000
    {
        return Err(invalid("研究构思数据版本或数量无效，原数据未更改"));
    }
    let mut boards = HashSet::new();
    for board in &state.boards {
        if !valid_id(&board.id)
            || !boards.insert(&board.id)
            || board.title.trim().is_empty()
            || board.title.len() > 1000
            || board.description.len() > 20000
            || board.created_at.len() > 64
            || board.updated_at.len() > 64
            || board
                .deleted_at
                .as_ref()
                .is_some_and(|date| date.is_empty() || date.len() > 64)
            || board.viewport.as_ref().is_some_and(|v| {
                !v.x.is_finite()
                    || !v.y.is_finite()
                    || v.x.abs() > 100000.0
                    || v.y.abs() > 100000.0
                    || !(0.2..=2.0).contains(&v.scale)
            })
        {
            return Err(invalid("构思标题或视图无效，原数据未更改"));
        }
    }
    let mut cards = HashSet::new();
    let mut card_kinds = HashMap::new();
    for card in &state.cards {
        if !valid_id(&card.id)
            || !valid_id(&card.entry_id)
            || !cards.insert(&card.id)
            || card.title.trim().is_empty()
            || card.title.len() > 1000
            || card.body.len() > 100_000
            || card.pattern_ids.len() > 8
            || card.pattern_ids.iter().any(|id| !valid_id(id))
            || card
                .origin
                .as_deref()
                .is_some_and(|origin| !["ai_draft", "ai_reviewed", "preset"].contains(&origin))
            || card.sources.len() > 10
            || card.sources.iter().any(|source| {
                !valid_segment_uid(&source.segment_uid) || source.quote.len() > 20_000
            })
            || ![
                "background",
                "problem",
                "method",
                "component",
                "constraint",
                "assumption",
                "result",
                "limitation",
                "idea",
            ]
            .contains(&card.kind.as_str())
        {
            return Err(invalid("论文卡片内容无效，原数据未更改"));
        }
        card_kinds.insert(&card.id, card.kind.as_str());
    }
    let mut placements = HashSet::new();
    for p in &state.placements {
        if !valid_id(&p.id)
            || !placements.insert(&p.id)
            || !cards.contains(&p.card_id)
            || (state.version == 2 && p.board_id.as_ref().is_none_or(|id| !boards.contains(id)))
            || p.title
                .as_ref()
                .is_some_and(|title| title.trim().is_empty() || title.len() > 1000)
            || p.body.as_ref().is_some_and(|body| body.len() > 100_000)
            || !p.x.is_finite()
            || !p.y.is_finite()
            || !(0.0..=10000.0).contains(&p.x)
            || !(0.0..=10000.0).contains(&p.y)
            || p.slot.as_deref().is_some_and(|slot| {
                ![
                    "background",
                    "problem",
                    "method",
                    "component",
                    "constraint",
                    "assumption",
                    "result",
                    "limitation",
                    "idea",
                ]
                .contains(&slot)
            })
            || p.slot
                .as_deref()
                .is_some_and(|slot| card_kinds.get(&p.card_id).copied() != Some(slot))
        {
            return Err(invalid("构思画布内容无效，原数据未更改"));
        }
    }
    let board_by_node: HashMap<_, _> = state
        .placements
        .iter()
        .map(|p| (&p.id, &p.board_id))
        .collect();
    let mut links = HashSet::new();
    for link in &state.links {
        if !valid_id(&link.id)
            || !links.insert(&link.id)
            || link.from == link.to
            || link.label.as_ref().is_some_and(|label| label.len() > 500)
            || link.description.len() > 20000
            || board_by_node.get(&link.from) != board_by_node.get(&link.to)
            || !placements.contains(&link.from)
            || !placements.contains(&link.to)
            || link.kind.as_deref().is_some_and(|kind| {
                ![
                    "related",
                    "addresses",
                    "input",
                    "combines",
                    "contrasts",
                    "supports",
                    "limits",
                    "feedback",
                    "hypothesis",
                    "alternative",
                    "progression",
                    "decomposes",
                    "depends_on",
                    "tests",
                    "challenges",
                    "motivates",
                ]
                .contains(&kind)
            })
            || link
                .origin
                .as_deref()
                .is_some_and(|origin| !["user", "ai_inferred"].contains(&origin))
            || link.entry_id.as_deref().is_some_and(|id| !valid_id(id))
            || link.sources.len() > 10
            || link.sources.iter().any(|source| {
                !valid_segment_uid(&source.segment_uid) || source.quote.len() > 20_000
            })
            || (link.origin.as_deref() == Some("ai_inferred")
                && (link.entry_id.is_none() || link.sources.is_empty()))
        {
            return Err(invalid("构思连线无效，原数据未更改"));
        }
    }
    Ok(())
}
pub(super) fn validate_draft(draft: &IdeationDraft, entry_id: &str) -> Result<(), WorkspaceError> {
    if draft.entry_id != entry_id
        || !valid_id(entry_id)
        || !["ready", "failed"].contains(&draft.status.as_str())
        || draft.cards.len() > 30
        || draft.model.len() > 500
        || (draft.status == "ready" && draft.cards.is_empty())
        || (draft.status == "failed" && !draft.cards.is_empty())
        || draft.cards.iter().any(|c| c.entry_id != entry_id)
        || draft.relations.len() > 60
        || draft.relations.iter().any(|relation| {
            relation.from == relation.to
                || !draft.cards.iter().any(|card| card.id == relation.from)
                || !draft.cards.iter().any(|card| card.id == relation.to)
                || ![
                    "related",
                    "addresses",
                    "input",
                    "combines",
                    "contrasts",
                    "supports",
                    "limits",
                    "feedback",
                    "hypothesis",
                ]
                .contains(&relation.kind.as_str())
                || relation.sources.is_empty()
                || relation.sources.len() > 10
                || relation.sources.iter().any(|source| {
                    !valid_segment_uid(&source.segment_uid) || source.quote.len() > 20_000
                })
        })
        || (draft.status == "failed" && !draft.relations.is_empty())
        || draft.error_code.as_deref().is_some_and(|code| {
            ![
                "timeout",
                "no_model",
                "no_content",
                "changed",
                "invalid_output",
                "auth",
                "rate_limit",
                "network",
                "model",
            ]
            .contains(&code)
        })
        || (draft.status == "ready" && draft.error_code.is_some())
    {
        return Err(invalid("卡片草稿内容无效，原文件已保留"));
    }
    validate(&IdeationState {
        version: 1,
        boards: Vec::new(),
        cards: draft.cards.clone(),
        placements: Vec::new(),
        links: Vec::new(),
    })
}
