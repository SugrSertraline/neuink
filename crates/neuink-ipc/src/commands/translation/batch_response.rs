use std::collections::{HashMap, HashSet};

use neuink_domain::SegmentUid;
use serde::Deserialize;
use serde_json::Value;

use super::{diagrams, parse_json_object, restore_formula_spans, ProtectedFormulaText};

#[derive(Deserialize)]
struct BatchResponse {
    segments: Vec<Value>,
}

#[derive(Deserialize)]
struct SegmentResponse {
    translated_text: String,
    #[serde(default)]
    diagram_labels: Vec<diagrams::TranslatedLabel>,
}

/// The envelope must be valid, but each member is independently untrusted.
/// Omit invalid members so the runner retries only those members, sequentially.
pub(super) fn restore_batch_translations(
    text: &str,
    protected: &HashMap<SegmentUid, ProtectedFormulaText>,
    diagrams: &HashMap<SegmentUid, diagrams::DiagramText>,
) -> Result<HashMap<SegmentUid, String>, String> {
    let response: BatchResponse = parse_json_object(text)?;
    let mut translations = HashMap::new();
    let mut seen = HashSet::new();
    for value in response.segments {
        let Some(uid) = value.get("segment_uid").and_then(Value::as_str) else {
            continue;
        };
        let uid = SegmentUid::from_string(uid.to_string());
        // Duplicate answers are ambiguous; retry that member rather than let
        // response order select which answer becomes the persisted translation.
        if !seen.insert(uid.clone()) {
            translations.remove(&uid);
            continue;
        }
        let Ok(segment) = serde_json::from_value::<SegmentResponse>(value) else {
            continue;
        };
        let (Some(source), Some(diagram)) = (protected.get(&uid), diagrams.get(&uid)) else {
            continue;
        };
        if segment.translated_text.trim().is_empty() {
            continue;
        }
        let restored = restore_formula_spans(&segment.translated_text, &source.formulas)
            .and_then(|text| diagram.restore(&text, &segment.diagram_labels));
        if let Ok(text) = restored {
            if !text.trim().is_empty() {
                translations.insert(uid, text);
            }
        }
    }
    Ok(translations)
}

#[cfg(test)]
mod tests;
