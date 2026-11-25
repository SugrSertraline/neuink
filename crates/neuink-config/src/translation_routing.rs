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
    Service {
        provider: crate::SelectionTranslationProvider,
    },
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
    /// DefaultModel here preserves the legacy translation profile; in routes it follows this source.
    pub default_source: TranslationSource,
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
            default_source: TranslationSource::DefaultModel,
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
        let source = match kind {
            TranslationKind::Word => &self.word,
            TranslationKind::Selection => &self.selection,
            TranslationKind::Segment => &self.segment,
            TranslationKind::Paragraph => &self.paragraph,
            TranslationKind::Document => &self.document,
        };
        if matches!(source, TranslationSource::DefaultModel) { &self.default_source } else { source }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_services_follow_live_changes_without_overwriting_overrides() {
        let mut routing = TranslationRoutingSettings::default();
        routing.default_source = TranslationSource::Service { provider: crate::SelectionTranslationProvider::Niutrans };
        routing.word = TranslationSource::DefaultModel;
        routing.selection = TranslationSource::DefaultModel;
        for kind in [TranslationKind::Word, TranslationKind::Selection, TranslationKind::Segment, TranslationKind::Paragraph, TranslationKind::Document] {
            assert_eq!(routing.source(kind), &routing.default_source);
        }
        routing.paragraph = TranslationSource::Profile { profile_id: "precise".into() };
        routing.default_source = TranslationSource::Profile { profile_id: "fast".into() };
        assert_eq!(routing.source(TranslationKind::Document), &routing.default_source);
        assert_eq!(routing.source(TranslationKind::Paragraph), &routing.paragraph);
        let restored: TranslationRoutingSettings = serde_json::from_str(&serde_json::to_string(&routing).unwrap()).unwrap();
        assert_eq!(restored, routing);
    }

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
