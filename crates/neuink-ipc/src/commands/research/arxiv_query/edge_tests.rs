use super::*;
use serde_json::json;

#[test]
fn step2_legacy_archive_v_is_not_a_version_marker() {
    for (input, base, version) in [
        ("solv-int/9901001", "solv-int/9901001", None),
        ("solv-int/9901001v2", "solv-int/9901001", Some(2)),
        (
            "https://arxiv.org/abs/solv-int/9901001",
            "solv-int/9901001",
            None,
        ),
    ] {
        let actual = normalize_id(input).unwrap();
        assert_eq!(actual.base_id, base);
        assert_eq!(actual.version, version);
        println!(
            "STEP2_JSON {}",
            json!({"case_id":"T-STEP2-ARCHIVE-V","input":input,"actual":actual})
        );
    }
}

#[test]
fn step2_unknown_fields_enums_types_and_id_mode_exclusivity() {
    let now = "2026-10-20T08:00:00Z".parse().unwrap();
    let mut inputs = vec![
        json!({"mode":"raw"}),
        json!({"mode":"ids"}),
        json!({"mode":"structured","query":123}),
        json!({"mode":"structured","keywords":"x"}),
        json!({"mode":"structured","keywords":[123]}),
        json!({"mode":"structured","categories":[123]}),
        json!({"mode":"ids","ids":[123]}),
        json!({"mode":"raw","raw_query":123}),
        json!({"mode":"structured","query":"x","search_field":"category"}),
        json!({"mode":"structured","query":"x","search_field":"id"}),
        json!({"mode":"structured","query":"x","sort_by":"updated"}),
        json!({"mode":"structured","query":"x","sort_order":"DESC"}),
    ];
    for field in [
        "query",
        "keywords",
        "raw_query",
        "categories",
        "search_field",
        "sort_by",
        "sort_order",
        "start",
        "page_size",
        "max_results",
        "days_back",
    ] {
        let mut input = json!({"mode":"ids","ids":["2401.00001"]});
        input[field] = json!("ignored?");
        inputs.push(input);
    }
    for input in inputs {
        let error = prepare(&input, now).unwrap_err();
        println!(
            "STEP2_JSON {}",
            json!({"case_id":"T-STEP2-INVALID","input":input,"actual":error})
        );
    }
}

#[test]
fn step2_no_default_date_or_hidden_category_and_no_mutation() {
    let now = "2026-10-20T08:00:00Z".parse().unwrap();
    let input = json!({"mode":"structured","query":"  multi word  "});
    let before = input.clone();
    let PreparedQuery::Search { plan } = prepare(&input, now).unwrap() else {
        panic!("search plan")
    };
    assert_eq!(input, before);
    assert_eq!(
        plan.effective_query,
        "((ti:\"  multi word  \" OR abs:\"  multi word  \"))"
    );
    assert_eq!(plan.start, 0);
    assert_eq!(plan.page_size, 20);
    assert_eq!(plan.max_results, 20);
    assert!(plan.date_filter.is_none());
    println!(
        "STEP2_JSON {}",
        json!({"case_id":"T-STEP2-DEFAULTS","input":input,"actual":plan})
    );
}

#[test]
fn step2_integral_json_numbers_match_schema_without_rounding() {
    let now = "2026-10-20T08:00:00Z".parse().unwrap();
    let input = json!({"mode":"structured","query":"x","page_size":1.0,"max_results":2.0,"start":0.0,"days_back":7.0});
    let original = input.clone();
    let PreparedQuery::Search { plan } = prepare(&input, now).unwrap() else {
        panic!("search plan")
    };
    assert_eq!(input, original);
    assert_eq!(plan.page_size, 1);
    assert_eq!(plan.max_results, 2);
    let bad = json!({"mode":"structured","query":"x","page_size":1.5});
    assert!(prepare(&bad, now).is_err());
    println!(
        "STEP2_JSON {}",
        json!({"case_id":"T-STEP2-INTEGRAL-NUMBERS","input":input,"actual":plan,"original_unchanged":true})
    );
}

#[test]
fn step2_array_limits_apply_before_dedup_and_large_urls_are_explicit() {
    let now = "2026-10-20T08:00:00Z".parse().unwrap();
    let inputs = [
        json!({"mode":"structured","keywords":vec!["x";20]}),
        json!({"mode":"structured","categories":vec!["cs.AI";20]}),
        json!({"mode":"ids","ids":(1..=100).map(|i|format!("2401.{i:05}")).collect::<Vec<_>>()}),
    ];
    for input in inputs {
        let prepared = prepare(&input, now).unwrap();
        println!(
            "STEP2_JSON {}",
            json!({"case_id":"T-STEP2-ARRAY-MAX","input":input,
            "actual":{"plan":prepared,"url_bytes":prepared.initial_url().unwrap().as_str().len()}})
        );
    }
    let large_ids: Vec<_> = (1..=100)
        .map(|i| format!("{}/9901{i:03}", "a".repeat(60)))
        .collect();
    let input = json!({"mode":"ids","ids":large_ids});
    let error = prepare(&input, now).unwrap_err();
    assert_eq!(error.code, "encoded_url_limit");
    println!(
        "STEP2_JSON {}",
        json!({"case_id":"T-STEP2-ID-URL-LIMIT","input":{"id_count":100,"archive_length":60},"actual":error})
    );
}

#[test]
fn step2_exact_encoded_url_boundary_and_paging_sum() {
    let now = "2026-10-20T08:00:00Z".parse().unwrap();
    let one = prepare(&json!({"mode":"raw","raw_query":"x"}), now).unwrap();
    let overhead = one.initial_url().unwrap().as_str().len() - 1;
    let chars = 4096 - overhead;
    assert!(chars < 4000);
    let exact = prepare(&json!({"mode":"raw","raw_query":"x".repeat(chars)}), now).unwrap();
    assert_eq!(exact.initial_url().unwrap().as_str().len(), 4096);
    let error = prepare(
        &json!({"mode":"raw","raw_query":"x".repeat(chars + 1)}),
        now,
    )
    .unwrap_err();
    assert_eq!(error.code, "encoded_url_limit");
    let paging = prepare(
        &json!({"mode":"raw","raw_query":"x","start":29999,"max_results":2}),
        now,
    )
    .unwrap_err();
    assert_eq!(paging.code, "limit_exceeded");
    println!(
        "STEP2_JSON {}",
        json!({"case_id":"T-STEP2-EXACT-BOUNDS","input":{"raw_chars":chars},
        "actual":{"url_bytes":4096,"one_more_character_error":error,"page_window_error":paging}})
    );
}
