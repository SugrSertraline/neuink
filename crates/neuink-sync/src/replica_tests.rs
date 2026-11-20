use super::*;
#[test]
fn dispatch_requires_the_exact_bound_identity_and_recovery_epoch() {
    let dir = tempfile::tempdir().unwrap();
    let mut replica = Replica::open(&dir.path().join("s"), &binding(), "e").unwrap();
    replica
        .edit("n", ObjectKind::Note, Some(&json!("preserved")))
        .unwrap();
    let before = replica.pending().unwrap();
    replica.check_binding(&binding(), "e").unwrap();
    for other in [
        Binding {
            server_id: "other".into(),
            ..binding()
        },
        Binding {
            account_id: "other".into(),
            ..binding()
        },
        Binding {
            library_id: "other".into(),
            ..binding()
        },
    ] {
        assert!(replica.check_binding(&other, "e").is_err());
    }
    assert!(replica.check_binding(&binding(), "new-epoch").is_err());
    assert_eq!(replica.pending().unwrap(), before);
}

#[test]
fn stale_conflict_choice_preserves_new_edits_and_remote_changes() {
    let dir = tempfile::tempdir().unwrap();
    let mut replica = Replica::open(&dir.path().join("s"), &binding(), "e").unwrap();
    let change = |text: &str, revision| RemoteChange {
        object_id: "note".into(),
        kind: ObjectKind::Note,
        content: Some(json!(text)),
        deleted: false,
        revision,
    };
    replica.receive(&change("base", 1)).unwrap();
    replica
        .edit("note", ObjectKind::Note, Some(&json!("local")))
        .unwrap();
    replica.receive(&change("remote", 2)).unwrap();
    let shown = replica.conflict_detail("note").unwrap();
    assert_eq!(shown.base, Some(json!("base")));
    assert_eq!(shown.local, Some(json!("local")));
    replica
        .edit("note", ObjectKind::Note, Some(&json!("new local")))
        .unwrap();
    assert!(replica
        .resolve_if_current("note", false, &shown.token)
        .is_err());
    assert_eq!(replica.content("note").unwrap(), Some(json!("new local")));
    let shown = replica.conflict_detail("note").unwrap();
    replica.receive(&change("new remote", 3)).unwrap();
    assert!(replica
        .resolve_if_current("note", true, &shown.token)
        .is_err());
    let current = replica.conflict_detail("note").unwrap();
    replica
        .resolve_if_current("note", true, &current.token)
        .unwrap();
    let pending = replica.pending().unwrap();
    assert_eq!(pending[0].base_revision, Some(3));
    assert_eq!(replica.content("note").unwrap(), Some(json!("new local")));
    assert!(replica.conflicts().unwrap().is_empty());
}
#[test]
fn convergence_clears_a_previously_recorded_conflict() {
    let dir = tempfile::tempdir().unwrap();
    let mut replica = Replica::open(&dir.path().join("s"), &binding(), "e").unwrap();
    replica
        .edit("note", ObjectKind::Note, Some(&serde_json::json!("local")))
        .unwrap();
    replica
        .receive(&RemoteChange {
            object_id: "note".into(),
            kind: ObjectKind::Note,
            content: Some(serde_json::json!("remote")),
            deleted: false,
            revision: 1,
        })
        .unwrap();
    assert_eq!(replica.conflicts().unwrap().len(), 1);
    replica
        .receive(&RemoteChange {
            object_id: "note".into(),
            kind: ObjectKind::Note,
            content: Some(serde_json::json!("local")),
            deleted: false,
            revision: 2,
        })
        .unwrap();
    assert!(replica.conflicts().unwrap().is_empty());
    assert!(replica.pending().unwrap().is_empty());
}

#[test]
fn invalid_remote_type_does_not_advance_cursor_or_modify_content() {
    let dir = tempfile::tempdir().unwrap();
    let mut replica = Replica::open(&dir.path().join("s"), &binding(), "e").unwrap();
    replica
        .edit("note", ObjectKind::Note, Some(&serde_json::json!("local")))
        .unwrap();
    assert!(replica
        .receive(&RemoteChange {
            object_id: "note".into(),
            kind: ObjectKind::Entry,
            content: None,
            deleted: true,
            revision: 1
        })
        .is_err());
    assert_eq!(replica.cursor().unwrap(), 0);
    assert_eq!(
        replica.content("note").unwrap(),
        Some(serde_json::json!("local"))
    );
}
use serde_json::json;
fn binding() -> Binding {
    Binding {
        server_id: "s".into(),
        account_id: "a".into(),
        library_id: "l".into(),
    }
}
#[test]
fn restart_keeps_operation_id_and_new_edit_during_upload() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sync.sqlite");
    let mut r = Replica::open(&path, &binding(), "e").unwrap();
    r.edit("n", ObjectKind::Note, Some(&json!("first")))
        .unwrap();
    let op = r.pending().unwrap().remove(0);
    drop(r);
    let mut r = Replica::open(&path, &binding(), "e").unwrap();
    assert_eq!(r.pending().unwrap()[0], op);
    r.edit("n", ObjectKind::Note, Some(&json!("second")))
        .unwrap();
    r.acknowledge(&op.operation_id, 1).unwrap();
    let next = r.pending().unwrap().remove(0);
    assert_eq!(next.base_revision, Some(1));
    assert_ne!(next.operation_id, op.operation_id);
    assert_eq!(r.content("n").unwrap(), Some(json!("second")));
}
#[test]
fn concurrent_delete_is_preserved_until_explicit_resolution() {
    let dir = tempfile::tempdir().unwrap();
    let mut r = Replica::open(&dir.path().join("s"), &binding(), "e").unwrap();
    r.receive(&RemoteChange {
        object_id: "n".into(),
        kind: ObjectKind::Note,
        content: Some(json!("base")),
        deleted: false,
        revision: 1,
    })
    .unwrap();
    r.edit("n", ObjectKind::Note, Some(&json!("offline")))
        .unwrap();
    r.receive(&RemoteChange {
        object_id: "n".into(),
        kind: ObjectKind::Note,
        content: None,
        deleted: true,
        revision: 2,
    })
    .unwrap();
    assert_eq!(r.cursor().unwrap(), 2);
    assert_eq!(r.conflicts().unwrap().len(), 1);
    assert!(r.pending().unwrap().is_empty());
    assert_eq!(r.content("n").unwrap(), Some(json!("offline")));
    r.resolve("n", true).unwrap();
    assert!(matches!(
        r.pending().unwrap()[0].mutation,
        Mutation::Restore { .. }
    ));
}
#[test]
fn prevents_cross_account_and_restored_server_reuse() {
    let d = tempfile::tempdir().unwrap();
    let p = d.path().join("s");
    drop(Replica::open(&p, &binding(), "old").unwrap());
    assert!(Replica::open(&p, &binding(), "new").is_err());
    let mut b = binding();
    b.account_id = "b".into();
    assert!(Replica::open(&p, &b, "old").is_err());
}
