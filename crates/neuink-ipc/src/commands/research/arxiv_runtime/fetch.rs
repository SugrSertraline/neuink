use super::{Failure, Outcome};
use crate::commands::research::{
    arxiv_feed::{parse_page, Page},
    arxiv_http::Transport,
};
pub async fn page(
    url: reqwest::Url,
    transport: &impl Transport,
    output: &mut Outcome,
) -> Result<Page, Failure> {
    output.transport_calls += 1;
    let response = transport.get_gate(url).await.map_err(|error| Failure {
        code: if error.http_status==Some(400){"upstream_query_error".into()}else{error.code.clone()}, http_status:error.http_status, gate:Some(error),
    })?;
    if !(200..300).contains(&response.status) {
        return Err(Failure { code:if response.status==400 {"upstream_query_error"}else{"http_error"}.into(), http_status:Some(response.status), gate:None });
    }
        let text =
            std::str::from_utf8(&response.bytes).map_err(|_| Failure::new("invalid_encoding"))?;
    parse_page(text).map_err(Failure::new)
}
