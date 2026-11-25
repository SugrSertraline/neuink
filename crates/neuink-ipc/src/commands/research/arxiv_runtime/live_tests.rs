use super::tests::observe;
use super::*;
use crate::commands::research::arxiv_http::Native;
use serde_json::json;

#[tokio::test]
#[ignore = "explicit real arXiv API probe; no PDF or model"]
async fn step3_live_id_and_two_pages() {
    for (case, args) in [
        ("live_id", json!({"mode":"ids","ids":["1706.03762v1"]})),
        (
            "live_two_pages",
            json!({"mode":"structured","query":"attention","search_field":"title","page_size":1,"max_results":2}),
        ),
    ] {
        let query = arxiv_query::prepare(&args, chrono::Utc::now()).unwrap();
        let result = execute(&query, &Native, &Cancellation::default()).await;
        match result {
            Ok(result) => {
                observe(case, &result);
                assert_eq!(result.status, "ok");
                assert_eq!(result.returned_count, if case == "live_id" { 1 } else { 2 });
            }
            Err(error) => {
                println!("STEP3_JSON {}", json!({"case":case,"actual_error":error}));
                panic!("real arXiv probe failed: {}", error.code);
            }
        }
    }
}

#[tokio::test]
#[ignore = "explicit small real arXiv boundary probes"]
async fn step3_live_date_missing_and_raw_error() {
    let query = arxiv_query::prepare(&json!({"mode":"structured","keywords":["attention","transformer"],"categories":["cs.LG"],"days_back":7,"sort_by":"lastUpdatedDate","page_size":1,"max_results":1}),chrono::Utc::now()).unwrap();
    let result = execute(&query, &Native, &Cancellation::default()).await;
    match result {
        Ok(result) => {
            observe("live_date_updated_sort", &result);
            let range = result.date_filter.as_ref().unwrap();
            for paper in &result.papers {
                let published =
                    chrono::DateTime::parse_from_rfc3339(paper.arxiv.published.as_ref().unwrap())
                        .unwrap()
                        .with_timezone(&chrono::Utc);
                assert!(
                    published >= range.from_utc
                        && published < range.to_utc + chrono::Duration::minutes(1)
                );
            }
            assert_eq!(result.status, "ok");
        }
        Err(error) => {
            println!(
                "STEP3_JSON {}",
                json!({"case":"live_date_updated_sort","actual_error":error})
            );
            panic!("date probe failed");
        }
    }
    let query = arxiv_query::prepare(
        &json!({"mode":"ids","ids":["1706.03762","2401.99999"]}),
        chrono::Utc::now(),
    )
    .unwrap();
    match execute(&query, &Native, &Cancellation::default()).await {
        Ok(result) => {
            observe("live_unversioned_and_missing", &result);
            assert_eq!(result.returned_count, 1);
            assert_eq!(result.missing_ids, ["2401.99999"]);
            assert!(result.papers[0].id.starts_with("arxiv:1706.03762v"));
        }
        Err(error) => {
            println!(
                "STEP3_JSON {}",
                json!({"case":"live_unversioned_and_missing","actual_error":error})
            );
            panic!("mixed ID probe failed");
        }
    }
    let query = arxiv_query::prepare(
        &json!({"mode":"raw","raw_query":"ti:(","page_size":1,"max_results":1}),
        chrono::Utc::now(),
    )
    .unwrap();
    let result = execute(&query, &Native, &Cancellation::default()).await;
    match result {
        Ok(result) => {
            observe("live_raw_malformed", &result);
            panic!("malformed query was accepted upstream");
        }
        Err(error) => {
            println!(
                "STEP3_JSON {}",
                json!({"case":"live_raw_malformed","actual_error":error})
            );
            assert_eq!(error.code, "upstream_query_error");
        }
    }
}
