use super::request::*;
use serde_json::{json, Map, Value};

pub fn input_schema() -> Value {
    let phrase = json!({"type":"string","minLength":1,"maxLength":MAX_QUERY_CHARS,"pattern":"\\S"});
    let mut structured = Map::from_iter([
        ("mode".into(), json!({"const":"structured","type":"string"})),
        ("query".into(), phrase.clone()),
        (
            "keywords".into(),
            json!({"type":"array","minItems":1,"maxItems":MAX_TERMS,"items":phrase}),
        ),
        (
            "search_field".into(),
            json!({"type":"string","enum":["all","title","abstract","title_abstract","author","comment","journal_ref","report_number"]}),
        ),
        (
            "categories".into(),
            json!({"type":"array","minItems":1,"maxItems":MAX_CATEGORIES,"items":{"type":"string","minLength":1,"maxLength":MAX_CATEGORY_CHARS,"pattern":"^[A-Za-z][A-Za-z0-9-]*(?:\\.[A-Za-z][A-Za-z0-9-]*)*(?:\\.\\*)?$"}}),
        ),
        (
            "days_back".into(),
            json!({"type":"integer","minimum":1,"maximum":MAX_DAYS_BACK}),
        ),
    ]);
    let mut raw = Map::from_iter([
        ("mode".into(), json!({"const":"raw","type":"string"})),
        (
            "raw_query".into(),
            json!({"type":"string","minLength":1,"maxLength":MAX_RAW_CHARS,"pattern":"\\S"}),
        ),
    ]);
    for fields in [&mut structured, &mut raw] {
        fields.insert(
            "sort_by".into(),
            json!({"type":"string","enum":["relevance","submittedDate","lastUpdatedDate"]}),
        );
        fields.insert(
            "sort_order".into(),
            json!({"type":"string","enum":["ascending","descending"]}),
        );
        fields.insert(
            "start".into(),
            json!({"type":"integer","minimum":0,"maximum":MAX_WINDOW_END - 1}),
        );
        for field in ["page_size", "max_results"] {
            fields.insert(field.into(), json!({"type":"integer","minimum":1,"maximum":MAX_RESULTS,"default":DEFAULT_RESULTS}));
        }
    }
    json!({"type":"object","oneOf":[
        {"type":"object","additionalProperties":false,"required":["mode"],"properties":structured,
            "anyOf":[{"required":["query"]},{"required":["keywords"]},{"required":["categories"]}],
            "not":{"required":["query","keywords"]},
            "if":{"required":["search_field"]},"then":{"anyOf":[{"required":["query"]},{"required":["keywords"]}]}},
        {"type":"object","additionalProperties":false,"required":["mode","raw_query"],"properties":raw},
        {"type":"object","additionalProperties":false,"required":["mode","ids"],"properties":{
            "mode":{"const":"ids","type":"string"},"ids":{"type":"array","minItems":1,"maxItems":MAX_IDS,
                "items":{"type":"string","minLength":1,"maxLength":MAX_ID_INPUT_CHARS,"pattern":"\\S"}}}}
    ]})
}
