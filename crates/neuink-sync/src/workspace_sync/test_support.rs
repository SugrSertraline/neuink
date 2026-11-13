use super::*;
use crate::replica::RemoteChange;
pub(super) fn binding() -> WorkspaceSyncBinding {
    WorkspaceSyncBinding {
        server_id: "1".repeat(64),
        account_id: "2".repeat(64),
        library_id: "3".repeat(64),
        epoch: "4".repeat(64),
    }
}
pub(super) fn replica(workspace: &Workspace, b: &WorkspaceSyncBinding) -> Replica {
    Replica::open(
        &workspace.sync_replica_path(b).unwrap(),
        &Binding {
            server_id: b.server_id.clone(),
            account_id: b.account_id.clone(),
            library_id: b.library_id.clone(),
        },
        &b.epoch,
    )
    .unwrap()
}
pub(super) fn exchange(from: &mut Replica, to: &mut Replica, revision: &mut u64) {
    for operation in from.pending().unwrap() {
        *revision += 1;
        let content = match operation.mutation {
            Mutation::Put { content } | Mutation::Restore { content } => Some(content),
            Mutation::Delete => None,
        };
        to.receive(&RemoteChange {
            object_id: operation.object_id,
            kind: operation.kind,
            deleted: content.is_none(),
            content,
            revision: *revision,
        })
        .unwrap();
        from.acknowledge(&operation.operation_id, *revision)
            .unwrap();
    }
}
