pub mod annotation;
pub mod assistant;
pub mod assistant_proposal;
pub mod assistant_routing;
pub mod browser;
mod browser_isolation;
pub mod conversation;
pub mod daily;
pub mod deep_research;
pub mod edit_recovery;
pub mod embedding;
pub mod embedding_resources;
pub mod entry;
#[cfg(test)]
mod entry_mineru_pdf_tests;
pub mod export;
pub mod folding;
pub mod ideation;
pub mod job;
mod llm_http;
pub mod local_agent;
pub mod mineru;
pub mod note_catalog;
pub mod onboarding;
pub mod pdf_parse_queue;
#[cfg(test)]
mod pdf_parse_queue_tests;
pub mod pdf_reader;
pub mod pdf_text;
pub mod recommendations;
pub mod research;
pub mod sciverse;
pub mod search;
pub mod selection_translation;
pub mod settings;
pub mod tag;
pub mod tag_note;
pub mod tag_reading;
#[cfg(test)]
mod tag_tests;
pub mod translation;
pub mod translation_routing;
pub mod workspace;
pub mod zotero;

pub mod import_preview;

pub mod cloud_account;
pub mod sentence_translation;
