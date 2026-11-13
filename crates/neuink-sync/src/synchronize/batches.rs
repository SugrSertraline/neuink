use crate::replica::Replica;
use neuink_sync_protocol::{Mutation, Operation};
use std::collections::{BTreeMap, BTreeSet};
pub(super) struct Batch {
    pub operations: Vec<Operation>,
    pub grouped: bool,
}
pub(super) fn prepare(
    replica: &mut Replica,
    allowed: Option<&BTreeSet<String>>,
) -> Result<Vec<Batch>, String> {
    let mut batches = Vec::new();
    let mut deletes: BTreeMap<String, Vec<Operation>> = BTreeMap::new();
    for operation in replica.pending()? {
        if allowed.is_some_and(|ids| !ids.contains(&operation.object_id)) {
            continue;
        }
        if matches!(operation.mutation, Mutation::Delete) {
            if let Some(owner) = replica.deletion_owner(&operation.object_id)? {
                deletes.entry(owner).or_default().push(operation);
                continue;
            }
        }
        batches.push(Batch {
            operations: vec![operation],
            grouped: false,
        });
    }
    batches.extend(deletes.into_values().map(|operations| Batch {
        operations,
        grouped: true,
    }));
    Ok(batches)
}
