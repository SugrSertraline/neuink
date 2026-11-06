use super::{fetch, Failure, Outcome};
use crate::commands::research::{
    arxiv_http::Transport,
    arxiv_query::{normalize_id, ArxivId, PreparedQuery},
};
use std::collections::HashSet;

pub async fn run(
    ids: &[ArxivId],
    transport: &impl Transport,
    output: &mut Outcome,
) -> Result<(), Failure> {
    let mut consumed = 0;
    let mut accepted = HashSet::new();
    while consumed < ids.len() {
        let mut bases = HashSet::new();
        let batch: Vec<_> = ids[consumed..]
            .iter()
            .take(20)
            .take_while(|id| bases.insert(id.base_id.clone()))
            .cloned()
            .collect();
        let url = PreparedQuery::Ids { ids: batch.clone() }
            .initial_url()
            .map_err(|_| Failure::new("invalid_arguments"))?;
        let page = fetch::page(url, transport, output).await?;
        let count = page.papers.len() as u64;
        if page.total != Some(count)
            || page.start != Some(0)
            || page
                .page_size
                .is_none_or(|n| n < count || n > batch.len() as u64)
        {
            return Err(Failure::new("id_metadata_invalid"));
        }
        let mut matches = vec![None; batch.len()];
        let mut returned = HashSet::new();
        for paper in page.papers {
            let actual = normalize_id(&paper.id).map_err(|_| Failure::new("invalid_identity"))?;
            if actual.version.is_none() {
                return Err(Failure::new("invalid_identity"));
            }
            let Some(index) = batch.iter().position(|requested| {
                requested.id == actual.id
                    || (requested.version.is_none() && requested.base_id == actual.base_id)
            }) else {
                return Err(Failure::new("unexpected_id_or_version"));
            };
            if matches[index].is_some() || !returned.insert(actual.id) {
                return Err(Failure::new("ambiguous_id_response"));
            }
            matches[index] = Some(paper);
        }
        for (requested, paper) in batch.iter().zip(matches) {
            if let Some(paper) = paper {
                if accepted.insert(paper.id.clone()) {
                    output.papers.push(paper);
                }
            } else {
                output.missing_ids.push(requested.id.clone());
            }
        }
        consumed += batch.len();
        output.unresolved_ids = ids[consumed..].iter().map(|id| id.id.clone()).collect();
    }
    Ok(())
}
