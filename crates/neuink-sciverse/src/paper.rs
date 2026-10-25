use crate::{SciverseClient, SciverseResult};
use serde_json::{json, Value};

impl SciverseClient {
    /// Default projections are permission-aware. In particular, `file_name` is
    /// not a public meta-search field and makes the whole request fail with 400.
    pub async fn paper_metadata(
        &self,
        doc_id: &str,
        doi: Option<&str>,
    ) -> SciverseResult<Option<Value>> {
        let doc_id = doc_id.trim();
        let doi = doi.map(str::trim).filter(|v| !v.is_empty());
        let (field, value) = if !doc_id.is_empty() {
            ("doc_id", doc_id)
        } else if let Some(doi) = doi {
            ("doi", doi)
        } else {
            return Ok(None);
        };
        let response = self
            .meta_search(&json!({
                "filters": [{"field":field,"operator":"FILTER_OP_EQ","value":value}],
                "page":1,"page_size":2
            }))
            .await?;
        // Never substitute another version just because its title is identical.
        Ok(response["results"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|item| {
                item[field]
                    .as_str()
                    .is_some_and(|candidate| candidate.eq_ignore_ascii_case(value))
            })
            .cloned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        matchers::{method, path},
        Mock, MockServer, ResponseTemplate,
    };

    #[tokio::test]
    async fn uses_exact_identity_and_default_projection() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/meta-search"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({"results":[
                {"doc_id":"wrong","title":"Same title"},
                {"doc_id":"selected","access_oa_url":["http://example.org/paper.pdf"]}
            ]})))
            .mount(&server)
            .await;
        let client = SciverseClient::new(server.uri(), "test-token").unwrap();
        assert_eq!(
            client
                .paper_metadata("selected", None)
                .await
                .unwrap()
                .unwrap()["doc_id"],
            "selected"
        );
        let requests = server.received_requests().await.unwrap();
        let body: Value = requests[0].body_json().unwrap();
        assert!(body.get("fields").is_none());
        assert!(body.get("query").is_none());
        assert_eq!(body["filters"][0]["value"], "selected");
        assert!(client
            .paper_metadata("unavailable", None)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn doi_only_lookup_does_not_require_full_text_id() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/meta-search"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"results":[{"doi":"10.1234/TEST"}]})),
            )
            .mount(&server)
            .await;
        let client = SciverseClient::new(server.uri(), "test-token").unwrap();
        assert!(client
            .paper_metadata("", Some("10.1234/test"))
            .await
            .unwrap()
            .is_some());
        assert!(client.paper_metadata("", None).await.unwrap().is_none());
    }
}
