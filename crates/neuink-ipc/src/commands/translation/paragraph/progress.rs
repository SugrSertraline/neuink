use super::*;
use neuink_workspace::paragraph_translation::TranslationTiming;
use tauri::Emitter;

#[derive(Clone, Serialize)]
pub(super) struct LiveProgress {
    root: String,
    entry_id: String,
    segment_uid: String,
    job_id: String,
    source_hash: String,
    part: &'static str,
    phase: &'static str,
    sequence: u64,
    retry_after_ms: Option<u64>,
    paragraph: Option<String>,
    sentences: Vec<SentenceTranslation>,
    // Original sentence order also keeps untranslated text visible during generation.
    sources: Vec<String>,
    timing: TranslationTiming,
}

struct State {
    event: LiveProgress,
    began: Instant,
    changed: Instant,
    emitted: Option<Instant>,
    timing: TranslationTiming,
}

impl State {
    fn timing(&self) -> TranslationTiming {
        let mut timing = self.timing.clone();
        let elapsed = self.changed.elapsed().as_millis() as u64;
        match self.event.phase {
            "queued" => timing.queued_ms += elapsed,
            "rate_limited" => timing.rate_limit_ms += elapsed,
            _ => timing.generation_ms += elapsed,
        }
        timing.total_ms = self.began.elapsed().as_millis() as u64;
        timing
    }
    fn phase(&mut self, phase: &'static str, retry_after_ms: Option<u64>) {
        self.timing = self.timing();
        self.changed = Instant::now();
        self.event.phase = phase;
        self.event.retry_after_ms = retry_after_ms;
    }
    fn snapshot(&mut self, force: bool) -> Option<LiveProgress> {
        if !force
            && self
                .emitted
                .is_some_and(|at| at.elapsed() < Duration::from_millis(100))
        {
            return None;
        }
        self.emitted = Some(Instant::now());
        self.event.sequence += 1;
        self.event.timing = self.timing();
        Some(self.event.clone())
    }
}

#[derive(Clone)]
pub(super) struct ParagraphProgress(Arc<Mutex<State>>);

impl ParagraphProgress {
    pub(super) fn new(
        request: &ParagraphRequest,
        record: &ParagraphTranslation,
        sentences: bool,
    ) -> Self {
        let now = Instant::now();
        Self(Arc::new(Mutex::new(State {
            event: LiveProgress {
                root: request.root.to_string_lossy().to_string(),
                entry_id: request.entry_id.to_string(),
                segment_uid: record.segment_uid.to_string(),
                job_id: record.job_id.clone(),
                source_hash: record.source_hash.clone(),
                part: if sentences { "sentences" } else { "paragraph" },
                phase: "queued",
                sequence: 0,
                retry_after_ms: None,
                paragraph: None,
                sentences: Vec::new(),
                sources: if sentences {
                    sentences::split_sentences(&record.source_text)
                } else {
                    Vec::new()
                },
                timing: TranslationTiming::default(),
            },
            began: now,
            changed: now,
            emitted: None,
            timing: TranslationTiming::default(),
        })))
    }

    pub(super) fn client<R: Runtime>(&self, client: &LlmClient, app: &AppHandle<R>) -> LlmClient {
        let mut client = client.clone();
        client.interactive = true;
        let state = self.0.clone();
        let app = app.clone();
        let text_app = app.clone();
        client.activity = Some(Arc::new(move |phase| {
            let event = {
                let mut state = state.lock().unwrap_or_else(|error| error.into_inner());
                match phase {
                    RequestActivity::Queued => state.phase("queued", None),
                    RequestActivity::RateLimited(ms) => state.phase("rate_limited", Some(ms)),
                    RequestActivity::Generating => state.phase("generating", None),
                }
                state.snapshot(true)
            };
            if let Some(event) = event {
                let _ = app.emit("neuink://paragraph-translation-progress", event);
            }
        }));
        let state = self.0.clone();
        client.output = Some(Arc::new(move |text| {
            let event = {
                let mut state = state.lock().unwrap_or_else(|error| error.into_inner());
                if state.event.part == "sentences" {
                    state.event.sentences = partial::sentence_preview(text, &state.event.sources);
                } else {
                    state.event.paragraph = partial::paragraph_preview(text);
                }
                // A fallback/retry clears unvalidated output from the previous attempt.
                state.snapshot(text.is_empty())
            };
            if let Some(event) = event {
                let _ = text_app.emit("neuink://paragraph-translation-progress", event);
            }
        }));
        client
    }

    pub(super) fn timing(&self) -> TranslationTiming {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .timing()
    }
}
