
use super::*;

#[test]
fn saves_and_reopens_board_and_rejects_stale_or_invalid_writes() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let initial = workspace.read_ideation().unwrap();
    let mut state = initial.state;
    state.version = 1;
    state.cards.push(IdeationCard {
        id: "card-1".into(),
        entry_id: "entry-1".into(),
        title: "方法".into(),
        body: "用户整理".into(),
        kind: "method".into(),
        origin: None,
        pattern_ids: Vec::new(),
        sources: Vec::new(),
    });
    state.placements.push(IdeationPlacement {
        id: "placement-1".into(),
        card_id: "card-1".into(),
        board_id: None,
        title: None,
        body: None,
        x: 12.0,
        y: 30.0,
        slot: None,
        locked: false,
    });
    let saved = workspace
        .save_ideation(&initial.revision, state.clone())
        .unwrap();
    assert_eq!(saved.state.cards[0].body, "用户整理");
    assert_eq!(
        Workspace::open_existing(dir.path())
            .unwrap()
            .read_ideation()
            .unwrap()
            .state
            .placements[0]
            .x,
        12.0
    );
    state = saved.state.clone();
    state.cards[0].body = "stale edit".into();
    assert!(workspace
        .save_ideation(&initial.revision, state.clone())
        .is_err());
    state.cards[0].body = "用户整理".into();
    state.placements[0].slot = Some("problem".into());
    assert!(workspace
        .save_ideation(&saved.revision, state.clone())
        .is_err());
    state.placements[0].slot = Some("method".into());
    let slotted = workspace
        .save_ideation(&saved.revision, state.clone())
        .unwrap();
    state.placements[0].card_id = "missing".into();
    assert!(workspace.save_ideation(&slotted.revision, state).is_err());
    assert_eq!(
        workspace.read_ideation().unwrap().state.cards[0].body,
        "用户整理"
    );
}

#[test]
fn old_cards_load_and_sources_survive_round_trip() {
    let legacy = r#"{"version":1,"cards":[{"id":"c1","entry_id":"e1","title":"方法","body":"内容","kind":"method"}],"placements":[]}"#;
    let mut state: IdeationState = serde_json::from_str(legacy).unwrap();
    assert!(state.cards[0].sources.is_empty());
    state.cards[0].sources.push(IdeationSource {
        segment_uid: "pdf-text-v1:revision:2".into(),
        page_idx: 2,
        quote: "原文".into(),
    });
    validate(&state).unwrap();
    let round_trip: IdeationState =
        serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
    assert_eq!(round_trip.cards[0].sources[0].quote, "原文");
}

#[test]
fn links_round_trip_and_cannot_reference_missing_placements() {
    let legacy = r#"{"version":1,"cards":[{"id":"c1","entry_id":"e1","title":"问题","body":"内容","kind":"problem"}],"placements":[{"id":"p1","card_id":"c1","x":12,"y":10},{"id":"p2","card_id":"c1","x":100,"y":10}]}"#;
    let mut state: IdeationState = serde_json::from_str(legacy).unwrap();
    assert!(state.links.is_empty());
    state.links.push(IdeationLink {
        id: "l1".into(),
        from: "p1".into(),
        to: "p2".into(),
        kind: None,
        label: None,
        description: String::new(),
        origin: None,
        entry_id: None,
        sources: Vec::new(),
    });
    validate(&state).unwrap();
    let round_trip: IdeationState =
        serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
    assert_eq!(round_trip.links[0].to, "p2");
    state.placements.pop();
    assert!(validate(&state).is_err());
}

#[test]
fn generated_drafts_are_separate_from_user_cards_and_guard_concurrent_writes() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let draft = IdeationDraft {
        entry_id: "entry-1".into(),
        status: "ready".into(),
        partial: true,
        model: "model".into(),
        error_code: None,
        relations: Vec::new(),
        cards: vec![IdeationCard {
            id: "card-1".into(),
            entry_id: "entry-1".into(),
            title: "方法".into(),
            body: "草稿".into(),
            kind: "method".into(),
            origin: None,
            pattern_ids: Vec::new(),
            sources: Vec::new(),
        }],
    };
    let saved = workspace
        .save_ideation_draft("missing", draft.clone())
        .unwrap();
    assert_eq!(workspace.list_ideation_drafts().unwrap()[0].count, 1);
    assert!(workspace.read_ideation().unwrap().state.cards.is_empty());
    assert!(workspace
        .save_ideation_draft("missing", draft.clone())
        .is_err());
    let mut invalid = draft;
    invalid.cards[0].entry_id = "other".into();
    assert!(workspace
        .save_ideation_draft(&saved.revision, invalid)
        .is_err());
    assert_eq!(
        workspace
            .read_ideation_draft("entry-1")
            .unwrap()
            .draft
            .unwrap()
            .cards[0]
            .body,
        "草稿"
    );
    assert!(workspace.read_ideation_draft("../bad").is_err());
}

#[test]
fn draft_relations_require_known_cards_and_source_evidence() {
    let raw = r#"{"entry_id":"e1","status":"ready","model":"m","partial":true,"cards":[{"id":"c1","entry_id":"e1","title":"问题","body":"内容","kind":"problem"},{"id":"c2","entry_id":"e1","title":"组件","body":"内容","kind":"component","pattern_ids":["heterogeneous_decomposition"]}],"relations":[{"from":"c1","to":"c2","kind":"addresses","sources":[{"segment_uid":"s1","page_idx":0,"quote":"原文"}]}]}"#;
    let mut draft: IdeationDraft = serde_json::from_str(raw).unwrap();
    validate_draft(&draft, "e1").unwrap();
    draft.relations[0].sources.clear();
    assert!(validate_draft(&draft, "e1").is_err());
    draft.relations[0].sources.push(IdeationSource {
        segment_uid: "s1".into(),
        page_idx: 0,
        quote: "原文".into(),
    });
    draft.relations[0].to = "unknown".into();
    assert!(validate_draft(&draft, "e1").is_err());
}

#[test]
fn upgrades_legacy_board_without_writing_on_read_and_keeps_recoverable_backup() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let path = dir.path().join("ideation/state.json");
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let raw = r#"{"version":1,"cards":[{"id":"c","entry_id":"e","title":"背景","body":"原文","kind":"problem"}],"placements":[{"id":"p","card_id":"c","x":0,"y":0,"slot":"problem"}]}"#;
    fs::write(&path, raw).unwrap();
    let snapshot = workspace.read_ideation().unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), raw);
    assert_eq!(snapshot.state.version, 2);
    assert_eq!(snapshot.state.boards[0].title, "已有构思");
    assert_eq!(
        snapshot.state.placements[0].board_id.as_deref(),
        Some("legacy-board")
    );
    assert_eq!(snapshot.state.placements[0].x, 70.0);
    assert!(snapshot.state.placements[0].slot.is_none());
    let saved = workspace
        .save_ideation(&snapshot.revision, snapshot.state)
        .unwrap();
    let backup: IdeationState =
        serde_json::from_slice(&fs::read(path.with_file_name("state.v1.backup.json")).unwrap())
            .unwrap();
    assert_eq!(backup.version, 1);
    assert_eq!(backup.cards[0].body, "原文");
    let legacy: IdeationState = serde_json::from_str(raw).unwrap();
    assert!(workspace.save_ideation(&saved.revision, legacy).is_err());
}

#[test]
fn multiple_boards_preserve_local_edits_deleted_graphs_viewports_and_evidence() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let raw = r#"{"version":2,"boards":[{"id":"a","title":"第一条构思","viewport":{"x":-100,"y":20,"scale":0.7}},{"id":"b","title":"第二条构思","deleted_at":"2026-10-28"}],"cards":[{"id":"c","entry_id":"e","title":"来源卡片","body":"原始内容","kind":"method","sources":[{"segment_uid":"s","page_idx":2,"quote":"原文"}]}],"placements":[{"id":"p1","card_id":"c","board_id":"a","title":"我的改写","body":"尝试组合","x":0,"y":0},{"id":"p2","card_id":"c","board_id":"a","x":300,"y":0},{"id":"p3","card_id":"c","board_id":"b","x":0,"y":0}],"links":[{"id":"l","from":"p1","to":"p2","kind":"progression","label":"逐步引入约束","description":"先确认输入条件","origin":"user"}]}"#;
    let state: IdeationState = serde_json::from_str(raw).unwrap();
    let saved = workspace.save_ideation("missing", state).unwrap();
    let reopened = Workspace::open_existing(dir.path())
        .unwrap()
        .read_ideation()
        .unwrap();
    assert_eq!(reopened.state.cards[0].body, "原始内容");
    assert_eq!(reopened.state.cards[0].sources[0].quote, "原文");
    assert_eq!(
        reopened.state.placements[0].body.as_deref(),
        Some("尝试组合")
    );
    assert!(reopened.state.placements[2].body.is_none());
    assert!(reopened.state.boards[1].deleted_at.is_some());
    assert_eq!(
        reopened.state.boards[0].viewport.as_ref().unwrap().scale,
        0.7
    );
    assert_eq!(
        reopened.state.links[0].label.as_deref(),
        Some("逐步引入约束")
    );
    let mut state = saved.state;
    state.links[0].to = "p3".into();
    assert!(workspace
        .save_ideation(&saved.revision, state.clone())
        .is_err());
    state.links[0].to = "p2".into();
    state.placements[0].board_id = Some("missing".into());
    assert!(workspace
        .save_ideation(&saved.revision, state.clone())
        .is_err());
    state.placements[0].board_id = Some("a".into());
    state.boards[0].viewport.as_mut().unwrap().scale = 0.0;
    assert!(workspace
        .save_ideation(&saved.revision, state.clone())
        .is_err());
    state.boards[0].viewport.as_mut().unwrap().scale = 0.7;
    state.boards[1].deleted_at = None;
    assert!(workspace
        .save_ideation(&saved.revision, state)
        .unwrap()
        .state
        .boards[1]
        .deleted_at
        .is_none());
}
#[test]
fn batched_paper_drafts_allow_more_than_thirty_cards_and_preserve_previous_on_overflow() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let mut draft = IdeationDraft {
        entry_id: "paper".into(), status: "ready".into(), partial: false,
        model: "model".into(), error_code: None, relations: Vec::new(),
        cards: (0..300).map(|i| IdeationCard {
            id: format!("card-{i}"), entry_id: "paper".into(), title: "方法".into(),
            body: "来源清晰的整理".repeat(100), kind: "method".into(),
            origin: Some("ai_draft".into()), pattern_ids: Vec::new(), sources: Vec::new(),
        }).collect(),
    };
    let saved = workspace.save_ideation_draft("missing", draft.clone()).unwrap();
    assert_eq!(workspace.read_ideation_draft("paper").unwrap().draft.unwrap().cards.len(), 300);
    let mut extra = draft.cards[0].clone(); extra.id = "overflow".into(); draft.cards.push(extra);
    assert!(workspace.save_ideation_draft(&saved.revision, draft).is_err());
    assert_eq!(workspace.read_ideation_draft("paper").unwrap().revision, saved.revision);
    assert!(workspace.read_ideation().unwrap().state.cards.is_empty());
}
#[test]
fn user_can_delete_last_draft_card_without_triggering_automatic_regeneration() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let draft = IdeationDraft { entry_id: "paper".into(), status: "ready".into(), partial: false, model: "model".into(), error_code: None, relations: Vec::new(), cards: Vec::new() };
    workspace.save_ideation_draft("missing", draft).unwrap();
    let records = workspace.list_ideation_drafts().unwrap();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].count, 0);
    assert_eq!(records[0].status, "ready");
}
