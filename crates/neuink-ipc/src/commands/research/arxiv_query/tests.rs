use super::*;
use serde_json::json;

fn now() -> DateTime<Utc> {
    "2026-10-20T08:17:39.123Z".parse().unwrap()
}
fn search(input: Value) -> SearchPlan {
    match prepare(&input, now()).unwrap() {
        PreparedQuery::Search { plan } => plan,
        _ => panic!("expected search"),
    }
}
fn observe(case: &str, input: Value, actual: Value) {
    println!(
        "STEP2_JSON {}",
        json!({"case_id":case,"input":input,"actual":actual})
    );
}

#[test]
fn step2_reference_semantics_and_text_fields() {
    let input = json!({"mode":"structured","categories":["cs.AI","cs.LG"],"keywords":["LLM","large language model"]});
    let plan = search(input.clone());
    assert_eq!(plan.effective_query, "(cat:cs.AI OR cat:cs.LG) AND ((ti:\"LLM\" OR abs:\"LLM\") OR (ti:\"large language model\" OR abs:\"large language model\"))");
    observe(
        "T-STEP2-REFERENCE",
        input,
        serde_json::to_value(plan).unwrap(),
    );
    for (field, prefix) in [
        ("all", "all"),
        ("title", "ti"),
        ("abstract", "abs"),
        ("author", "au"),
        ("comment", "co"),
        ("journal_ref", "jr"),
        ("report_number", "rn"),
    ] {
        let input = json!({"mode":"structured","query":"A B","search_field":field});
        let plan = search(input.clone());
        assert_eq!(plan.effective_query, format!("({prefix}:\"A B\")"));
        assert!(!plan.effective_query.contains("cat:"));
        observe(
            "T-STEP2-FIELDS",
            input,
            json!({"query":plan.effective_query}),
        );
    }
    let input = json!({"mode":"structured","categories":["hep-th"]});
    assert_eq!(search(input.clone()).effective_query, "cat:hep-th");
    observe(
        "T-STEP2-CATEGORY-ONLY",
        input,
        json!({"query":"cat:hep-th","implicit_category":false}),
    );
}

#[test]
fn step2_fixed_utc_date_range_and_all_sorts() {
    for sort in ["relevance", "submittedDate", "lastUpdatedDate"] {
        for order in ["ascending", "descending"] {
            let input = json!({"mode":"structured","query":"LLM","days_back":7,"sort_by":sort,"sort_order":order});
            let plan = search(input.clone());
            assert_eq!(plan.sort_by.parameter(), sort);
            assert_eq!(plan.sort_order.parameter(), order);
            assert!(plan
                .effective_query
                .ends_with("submittedDate:[202610130817 TO 202610200817]"));
            let filter = plan.date_filter.as_ref().unwrap();
            assert_eq!(filter.field, "published");
            assert_eq!(filter.precision, "minute");
            assert_eq!(
                filter.to_utc,
                "2026-10-20T08:17:00Z".parse::<DateTime<Utc>>().unwrap()
            );
            observe(
                "T-STEP2-DATE-SORT",
                input,
                serde_json::to_value(plan).unwrap(),
            );
        }
    }
    let input = json!({"mode":"structured","categories":["cs.LG"],"days_back":2});
    let boundary: DateTime<Utc> = "2024-03-01T00:00:00Z".parse().unwrap();
    let prepared = prepare(&input, boundary).unwrap();
    assert!(prepared
        .initial_url()
        .unwrap()
        .query_pairs()
        .any(|(key, value)| key == "search_query" && value.contains("202402280000")));
    let invalid = prepare(&input, DateTime::<Utc>::MIN_UTC);
    assert_eq!(invalid.unwrap_err().code, "date_out_of_range");
    observe(
        "T-STEP2-DATE-EDGE",
        input,
        json!({"leap_year_from":"202402280000","underflow_rejected":true}),
    );
}

#[test]
fn step2_raw_is_opaque_and_url_encoded() {
    for raw in [
        "(cat:cs.LG OR cat:cs.AI) ANDNOT au:Smith",
        "ti:\"A & B\" OR abs:\"中文 + C++\"",
        "ti:\"unterminated",
        " all:test ",
    ] {
        let input = json!({"mode":"raw","raw_query":raw});
        let prepared = prepare(&input, now()).unwrap();
        let url = prepared.initial_url().unwrap();
        assert_eq!(url.host_str(), Some("export.arxiv.org"));
        assert!(url.fragment().is_none());
        assert_eq!(
            url.query_pairs()
                .filter(|(key, _)| key == "search_query")
                .count(),
            1
        );
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "search_query")
                .unwrap()
                .1,
            raw
        );
        observe(
            "T-STEP2-RAW-ENCODING",
            input,
            json!({"url":url.as_str(),"raw_unchanged":true,"syntax_checked":false}),
        );
    }
}

#[test]
fn step2_ids_preserve_old_prefix_versions_and_order() {
    let input = json!({"mode":"ids","ids":["hep-th/9901001v2","https://arxiv.org/abs/hep-th/9901001v2",
        "arxiv:2401.00001v3","http://arxiv.org/pdf/2401.00001v3.pdf","2401.00001","https://export.arxiv.org/pdf/math.GT/0301001v1"]});
    let prepared = prepare(&input, now()).unwrap();
    let PreparedQuery::Ids { ids } = &prepared else {
        panic!("expected ids")
    };
    assert_eq!(
        ids.iter().map(|id| id.id.as_str()).collect::<Vec<_>>(),
        vec![
            "hep-th/9901001v2",
            "2401.00001v3",
            "2401.00001",
            "math.GT/0301001v1"
        ]
    );
    assert_eq!(ids[0].base_id, "hep-th/9901001");
    assert_eq!(ids[0].version, Some(2));
    assert_eq!(ids[2].version, None);
    let url = prepared.initial_url().unwrap();
    assert_eq!(
        url.query_pairs()
            .find(|(key, _)| key == "id_list")
            .unwrap()
            .1,
        "hep-th/9901001v2,2401.00001v3,2401.00001,math.GT/0301001v1"
    );
    assert!(!url
        .query_pairs()
        .any(|(key, _)| key == "sortBy" || key == "start"));
    observe(
        "T-STEP2-IDS",
        input,
        json!({"normalized":ids,"url":url.as_str(),"network_requests":0}),
    );
}

#[test]
fn step2_bad_ids_do_not_turn_into_urls_or_different_versions() {
    for id in [
        "9901001v2",
        "hep-th/9913001",
        "2413.00001",
        "2401.123",
        "2401.123456",
        "2401.00001v0",
        "2401.00001v01",
        "2401.00001v4294967296",
        "https://evil.example/abs/2401.00001",
        "https://arxiv.org.evil.example/abs/2401.00001",
        "https://arxiv.org/abs/2401.00001?x=1",
        "https://arxiv.org/pdf/2401.00001#page=2",
        "https://u:p@arxiv.org/abs/2401.00001",
        "https://arxiv.org:444/abs/2401.00001",
        "https://arxiv.org/abs/hep-th%2F9901001v2",
        "https://arxiv.org/abs/../2401.00001",
        "file:///abs/2401.00001",
    ] {
        let input = json!({"mode":"ids","ids":[id]});
        let error = prepare(&input, now()).unwrap_err();
        assert_eq!(error.code, "invalid_id", "{id}");
        assert!(!error.message.contains(id));
        observe(
            "T-STEP2-BAD-ID",
            input,
            serde_json::to_value(error).unwrap(),
        );
    }
}

#[test]
fn step2_structured_literals_never_become_query_operators() {
    for term in [
        "a\" OR cat:math.PR",
        "path\\term",
        "line\nbreak",
        "\tterm",
        "\u{0000}",
    ] {
        let input = json!({"mode":"structured","keywords":[term]});
        let error = prepare(&input, now()).unwrap_err();
        assert!(matches!(
            error.code,
            "unrepresentable_literal" | "invalid_arguments"
        ));
        observe(
            "T-STEP2-LITERAL-REJECT",
            input,
            serde_json::to_value(error).unwrap(),
        );
    }
    let input = json!({"mode":"structured","query":"A AND B (C++) 中文","search_field":"title"});
    assert_eq!(
        search(input.clone()).effective_query,
        "(ti:\"A AND B (C++) 中文\")"
    );
    observe(
        "T-STEP2-LITERAL-KEEP",
        input,
        json!({"query":search(json!({"mode":"structured","query":"A AND B (C++) 中文","search_field":"title"})).effective_query}),
    );
}

#[test]
fn step2_invalid_shapes_nulls_cross_mode_and_ranges() {
    let mut inputs = vec![
        json!(null),
        json!([]),
        json!({}),
        json!({"query":"x"}),
        json!({"mode":"other"}),
        json!({"mode":"structured"}),
        json!({"mode":"structured","query":" "}),
        json!({"mode":"structured","keywords":[]}),
        json!({"mode":"structured","categories":[]}),
        json!({"mode":"structured","days_back":7}),
        json!({"mode":"structured","query":"x","keywords":["y"]}),
        json!({"mode":"structured","categories":["cs.AI"],"search_field":"title"}),
        json!({"mode":"raw","raw_query":"x","categories":["cs.AI"]}),
        json!({"mode":"raw","raw_query":"x","days_back":7}),
        json!({"mode":"raw","raw_query":"x","query":"y"}),
        json!({"mode":"ids","ids":[]}),
        json!({"mode":"structured","query":"x","categories":["cs.LG OR all:x"]}),
        json!({"mode":"structured","query":"x","query_extra":"unused"}),
    ];
    for field in [
        "query",
        "keywords",
        "categories",
        "search_field",
        "sort_by",
        "sort_order",
        "start",
        "page_size",
        "max_results",
        "days_back",
    ] {
        let mut input = json!({"mode":"structured","query":"x"});
        input[field] = Value::Null;
        inputs.push(input);
    }
    for field in [
        "query",
        "keywords",
        "categories",
        "sort_by",
        "sort_order",
        "days_back",
        "start",
        "page_size",
        "max_results",
    ] {
        let mut input = json!({"mode":"ids","ids":["2401.00001"]});
        input[field] = json!(1);
        inputs.push(input);
    }
    for field in ["page_size", "max_results"] {
        for value in [
            json!(-1),
            json!(0),
            json!(101),
            json!(1.5),
            json!("20"),
            json!(true),
        ] {
            let mut input = json!({"mode":"raw","raw_query":"all:x"});
            input[field] = value;
            inputs.push(input);
        }
    }
    for (field, value) in [
        ("start", json!(-1)),
        ("start", json!(30_000)),
        ("start", json!(u64::MAX)),
        ("days_back", json!(0)),
        ("days_back", json!(36_501)),
    ] {
        let mut input = json!({"mode":"structured","query":"x"});
        input[field] = value;
        inputs.push(input);
    }
    for input in inputs {
        let error = prepare(&input, now()).unwrap_err();
        observe(
            "T-STEP2-INVALID",
            input,
            serde_json::to_value(error).unwrap(),
        );
    }
}

#[test]
fn step2_limits_count_characters_then_check_encoded_url_bytes() {
    let input = json!({"mode":"structured","query":"x".repeat(1000)});
    assert!(prepare(&input, now()).is_ok());
    for (field, value, code) in [
        ("query", json!("x".repeat(1001)), "limit_exceeded"),
        ("keywords", json!(vec!["x"; 21]), "limit_exceeded"),
        ("categories", json!(vec!["cs.AI"; 21]), "limit_exceeded"),
    ] {
        let mut input = json!({"mode":"structured"});
        input[field] = value;
        assert_eq!(prepare(&input, now()).unwrap_err().code, code);
    }
    assert!(prepare(&json!({"mode":"ids","ids":vec!["2401.00001";100]}), now()).is_ok());
    assert_eq!(
        prepare(&json!({"mode":"ids","ids":vec!["2401.00001";101]}), now())
            .unwrap_err()
            .code,
        "limit_exceeded"
    );
    for (raw, expected) in [
        ("x".repeat(3900), None),
        ("x".repeat(4000), Some("encoded_url_limit")),
        ("中".repeat(1000), Some("encoded_url_limit")),
        ("x".repeat(4001), Some("limit_exceeded")),
    ] {
        let input = json!({"mode":"raw","raw_query":raw});
        let prepared = prepare(&input, now());
        assert_eq!(prepared.as_ref().err().map(|e| e.code), expected);
        observe(
            "T-STEP2-URL-LENGTH",
            json!({"raw_chars":input["raw_query"].as_str().unwrap().chars().count()}),
            json!({"url_bytes":prepared.as_ref().ok().map(|p| p.initial_url().unwrap().as_str().len()),"error":prepared.err()}),
        );
    }
    let input =
        json!({"mode":"raw","raw_query":"all:x","start":29999,"max_results":1,"page_size":100});
    let prepared = prepare(&input, now()).unwrap();
    assert!(prepared
        .initial_url()
        .unwrap()
        .query_pairs()
        .any(|(key, value)| key == "max_results" && value == "1"));
    observe(
        "T-STEP2-PAGING-PARAMS",
        input,
        serde_json::to_value(prepared).unwrap(),
    );
}

#[test]
fn step2_schema_export_for_offline_contract_check() {
    let schema = schema::input_schema();
    assert_eq!(schema["oneOf"].as_array().unwrap().len(), 3);
    for branch in schema["oneOf"].as_array().unwrap() {
        assert_eq!(branch["additionalProperties"], false);
    }
    observe("T-STEP2-SCHEMA", json!({}), json!({"schema":schema}));
}
