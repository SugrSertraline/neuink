//! Transport-neutral synchronization contracts. No file or network access.
use serde::{Deserialize, Serialize};
pub mod document;

pub const PROTOCOL_VERSION: u32 = 1;

/// Bind a local queue to an exact server/account/library, never just a URL.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Binding {
    pub server_id: String,
    pub account_id: String,
    pub library_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cursor {
    pub epoch: String,
    pub revision: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObjectKind {
    Entry,
    Note,
    Annotation,
    Tag,
    SegmentNote,
    Card,
    Board,
    Translation,
    Fold,
    ParseSnapshot,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum Mutation {
    Put { content: serde_json::Value },
    Delete,
    Restore { content: serde_json::Value },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Operation {
    pub operation_id: String,
    pub object_id: String,
    pub kind: ObjectKind,
    /// None means create, never an unconditional overwrite.
    pub base_revision: Option<u64>,
    pub mutation: Mutation,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Rejection {
    BindingMismatch,
    RebaselineRequired,
    InvalidOperation,
    RevisionConflict,
}

/// A check before dispatch, not a substitute for server-side authorization.
pub fn validate_dispatch(
    queue: &Binding,
    session: &Binding,
    cursor: &Cursor,
    server_epoch: &str,
) -> Result<(), Rejection> {
    if queue != session {
        return Err(Rejection::BindingMismatch);
    }
    if cursor.epoch != server_epoch {
        return Err(Rejection::RebaselineRequired);
    }
    Ok(())
}

pub fn validate_operation(operation: &Operation, current: Option<u64>) -> Result<(), Rejection> {
    if operation.operation_id.trim().is_empty() || operation.object_id.trim().is_empty() {
        return Err(Rejection::InvalidOperation);
    }
    if operation.base_revision != current {
        return Err(Rejection::RevisionConflict);
    }
    if current.is_none() && !matches!(operation.mutation, Mutation::Put { .. }) {
        return Err(Rejection::InvalidOperation);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> Binding {
        Binding {
            server_id: "server".into(),
            account_id: "alice".into(),
            library_id: "library".into(),
        }
    }
    #[test]
    fn switching_account_cannot_dispatch_old_queue() {
        let old = binding();
        let mut new = old.clone();
        new.account_id = "bob".into();
        assert_eq!(
            validate_dispatch(
                &old,
                &new,
                &Cursor {
                    epoch: "e1".into(),
                    revision: 2
                },
                "e1"
            ),
            Err(Rejection::BindingMismatch)
        );
    }
    #[test]
    fn restored_server_requires_rebaseline_even_at_same_revision() {
        assert_eq!(
            validate_dispatch(
                &binding(),
                &binding(),
                &Cursor {
                    epoch: "old".into(),
                    revision: 2
                },
                "restored"
            ),
            Err(Rejection::RebaselineRequired)
        );
    }
    #[test]
    fn create_cannot_overwrite_and_stale_delete_cannot_remove_new_edit() {
        let mut op = Operation {
            operation_id: "operation".into(),
            object_id: "note".into(),
            kind: ObjectKind::Note,
            base_revision: None,
            mutation: Mutation::Put {
                content: serde_json::json!({"text":"note"}),
            },
        };
        assert_eq!(validate_operation(&op, None), Ok(()));
        assert_eq!(
            validate_operation(&op, Some(1)),
            Err(Rejection::RevisionConflict)
        );
        op.base_revision = Some(1);
        op.mutation = Mutation::Delete;
        assert_eq!(
            validate_operation(&op, Some(2)),
            Err(Rejection::RevisionConflict)
        );
        assert_eq!(validate_operation(&op, Some(1)), Ok(()));
    }
}
