use super::*;
use crate::commands::translation::protect_formula_spans;
use serde_json::json;

fn decode(
    sources: &[(&str, &str)],
    segments: Value,
) -> Result<HashMap<SegmentUid, String>, String> {
    let diagrams: HashMap<_, _> = sources
        .iter()
        .map(|(uid, text)| {
            (
                SegmentUid::from_string(uid.to_string()),
                diagrams::DiagramText::prepare(text),
            )
        })
        .collect();
    let protected = diagrams
        .iter()
        .map(|(uid, diagram)| (uid.clone(), protect_formula_spans(&diagram.text, false)))
        .collect();
    restore_batch_translations(
        &json!({"segments": segments}).to_string(),
        &protected,
        &diagrams,
    )
}

fn uid(value: &str) -> SegmentUid {
    SegmentUid::from_string(value.to_string())
}

#[test]
fn malformed_member_does_not_discard_neighbors_or_missing_members() {
    let result = decode(
        &[
            ("a", "First"),
            ("b", "Second"),
            ("c", "Third"),
            ("d", "Fourth"),
        ],
        json!([
            {"segment_uid":"a", "translated_text":"第一段"},
            {"segment_uid":"b", "translated_text":42},
            {"segment_uid":"c", "translated_text":"第三段"},
            {"segment_uid":"unknown", "translated_text":"无关"},
            null
        ]),
    )
    .unwrap();
    assert_eq!(result.len(), 2);
    assert_eq!(result[&uid("a")], "第一段");
    assert_eq!(result[&uid("c")], "第三段");
    assert!(!result.contains_key(&uid("b")) && !result.contains_key(&uid("d")));
}

#[test]
fn failed_formula_and_mermaid_restoration_leave_valid_translations_intact() {
    let sources = [
        ("good-before", "First"),
        ("math", "Result $x_i$"),
        (
            "diagram",
            "```mermaid\ngraph TD\nA[Input] --> B[Output]\n```",
        ),
        ("good-after", "Last"),
    ];
    let result = decode(
        &sources,
        json!([
            {"segment_uid":"good-before", "translated_text":"首段"},
            {"segment_uid":"math", "translated_text":"丢失公式"},
            {"segment_uid":"diagram", "translated_text":"⟪NEUINK_DIAGRAM_0⟫",
                "diagram_labels":[{"label_id":0,"translated_text":"输入"}]},
            {"segment_uid":"good-after", "translated_text":"末段"}
        ]),
    )
    .unwrap();
    assert_eq!(result.len(), 2);
    assert_eq!(result[&uid("good-before")], "首段");
    assert_eq!(result[&uid("good-after")], "末段");
}

#[test]
fn malformed_diagram_labels_and_empty_text_are_isolated() {
    let result = decode(&[("a", "First"), ("b", "Second"), ("c", "Third")], json!([
        {"segment_uid":"a", "translated_text":"第一段"},
        {"segment_uid":"b", "translated_text":"第二段", "diagram_labels":[{"label_id":"wrong"}]},
        {"segment_uid":"c", "translated_text":"   "}
    ])).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[&uid("a")], "第一段");
}

#[test]
fn repeated_answers_retry_only_the_ambiguous_member() {
    let result = decode(
        &[("a", "First"), ("b", "Second")],
        json!([
            {"segment_uid":"a", "translated_text":"译文一"},
            {"segment_uid":"b", "translated_text":"保留"},
            {"segment_uid":"a", "translated_text":"译文二"},
            {"segment_uid":"a", "translated_text":"译文三"}
        ]),
    )
    .unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[&uid("b")], "保留");
}

#[test]
fn invalid_envelopes_still_request_single_member_recovery() {
    let empty = HashMap::new();
    assert!(restore_batch_translations("not JSON", &empty, &HashMap::new()).is_err());
    assert!(restore_batch_translations(r#"{"segments":{}}"#, &empty, &HashMap::new()).is_err());
}
