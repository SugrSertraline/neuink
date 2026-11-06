use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TranslationSource {
    #[default]
    DefaultModel,
    Profile {
        profile_id: String,
    },
    SelectionService,
}

#[derive(Clone, Copy)]
pub enum TranslationKind {
    Word,
    Selection,
    Segment,
    Paragraph,
    Document,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub struct TranslationRoutingSettings {
    pub word: TranslationSource,
    pub selection: TranslationSource,
    pub segment: TranslationSource,
    pub paragraph: TranslationSource,
    pub document: TranslationSource,
    pub local_dictionary_first: bool,
}

impl Default for TranslationRoutingSettings {
    fn default() -> Self {
        Self {
            // Preserve the existing selection-service choice for older installations.
            word: TranslationSource::SelectionService,
            selection: TranslationSource::SelectionService,
            segment: TranslationSource::DefaultModel,
            paragraph: TranslationSource::DefaultModel,
            document: TranslationSource::DefaultModel,
            local_dictionary_first: true,
        }
    }
}

impl TranslationRoutingSettings {
    pub fn source(&self, kind: TranslationKind) -> &TranslationSource {
        match kind {
            TranslationKind::Word => &self.word,
            TranslationKind::Selection => &self.selection,
            TranslationKind::Segment => &self.segment,
            TranslationKind::Paragraph => &self.paragraph,
            TranslationKind::Document => &self.document,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_settings_keep_existing_translation_sources() {
        let settings: crate::AppSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(
            settings.translation_routing,
            TranslationRoutingSettings::default()
        );
        let partial: TranslationRoutingSettings =
            serde_json::from_str(r#"{"paragraph":{"kind":"profile","profile_id":"precise"}}"#)
                .unwrap();
        assert!(partial.local_dictionary_first);
        assert_eq!(partial.selection, TranslationSource::SelectionService);
        assert_eq!(
            partial.paragraph,
            TranslationSource::Profile {
                profile_id: "precise".into()
            }
        );
        assert_eq!(
            serde_json::from_str::<TranslationRoutingSettings>(
                &serde_json::to_string(&partial).unwrap()
            )
            .unwrap(),
            partial
        );
    }
}
