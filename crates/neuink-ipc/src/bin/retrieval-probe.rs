//! One command that runs the whole retrieval pipeline and prints what it did.
//!
//! Why this exists: the pipeline spans routing, the visual vote, the rerank ladder and
//! evidence selection, and every one of them is behind a Tauri command. Measuring or
//! debugging the flow therefore used to need the desktop app. This binary calls the same
//! functions with plain arguments, so a question can be replayed from a terminal.
//!
//! ```powershell
//! cargo run -p neuink-ipc --bin retrieval-probe --features local-embedding -- `
//!   --root D:\data\library `
//!   --model-dir apps/desktop/src-tauri/resources/embedding-models/default `
//!   --question "what F1 does table 3 report?" `
//!   --rerank-mode heuristic
//! ```
//!
//! Output is one JSON object: counts, routing, carriers, per-task hits, degradation codes,
//! rerank rung, and wall-clock timings per stage.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use neuink_config::{RerankMode, RerankSettings, VisualEmbeddingSettings};
use neuink_ipc::commands::search::rerank_stage;
use neuink_ipc::commands::search::unified::{run_unified_search, UnifiedSearchRequest};
use neuink_ipc::commands::search::visual::{prepare_visual_index, provider_for};
use neuink_ipc::commands::search::PrepareVisualSearchIndexRequest;

struct Args {
    root: PathBuf,
    question: String,
    model_dir: PathBuf,
    sub_questions: Vec<String>,
    top_k: usize,
    rerank_mode: RerankMode,
    rerank_dir: Option<PathBuf>,
    visual_endpoint: Option<String>,
    skip_visual: bool,
    prepare_visual: bool,
    build_text_index: bool,
}

fn parse_args() -> Result<Args, String> {
    let mut args = std::env::args().skip(1);
    let mut root: Option<PathBuf> = None;
    let mut question: Option<String> = None;
    let mut model_dir: Option<PathBuf> = None;
    let mut sub_questions = Vec::new();
    let mut top_k = 20usize;
    let mut rerank_mode = RerankMode::Off;
    let mut rerank_dir = None;
    let mut visual_endpoint = None;
    let mut skip_visual = false;
    let mut prepare = false;
    let mut build_text_index = false;

    while let Some(flag) = args.next() {
        let mut value = || {
            args.next()
                .ok_or_else(|| format!("{flag} needs a value"))
        };
        match flag.as_str() {
            "--root" => root = Some(PathBuf::from(value()?)),
            "--question" => question = Some(value()?),
            "--model-dir" => model_dir = Some(PathBuf::from(value()?)),
            "--sub-question" => sub_questions.push(value()?),
            "--top-k" => {
                top_k = value()?.parse().map_err(|_| "--top-k must be a number")?
            }
            "--rerank-mode" => {
                rerank_mode = match value()?.as_str() {
                    "off" => RerankMode::Off,
                    "heuristic" => RerankMode::Heuristic,
                    "cross_encoder" => RerankMode::CrossEncoder,
                    other => return Err(format!("unknown rerank mode: {other}")),
                }
            }
            "--rerank-dir" => rerank_dir = Some(PathBuf::from(value()?)),
            "--visual-endpoint" => visual_endpoint = Some(value()?),
            "--skip-visual" => skip_visual = true,
            "--prepare-visual" => prepare = true,
            "--build-text-index" => build_text_index = true,
            "--help" | "-h" => {
                println!(
                    "retrieval-probe --root DIR --model-dir DIR --question TEXT \
                     [--sub-question TEXT]... [--top-k N] \
                     [--rerank-mode off|heuristic|cross_encoder] [--rerank-dir DIR] \
                     [--visual-endpoint URL] [--skip-visual] [--prepare-visual]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Args {
        root: root.ok_or("--root is required")?,
        question: question.ok_or("--question is required")?,
        model_dir: model_dir.ok_or("--model-dir is required (text embedding model)")?,
        sub_questions,
        top_k,
        rerank_mode,
        rerank_dir,
        visual_endpoint,
        skip_visual,
        prepare_visual: prepare,
        build_text_index,
    })
}

fn main() {
    if let Err(error) = run() {
        eprintln!("retrieval-probe: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let mut report = serde_json::Map::new();
    let started = Instant::now();

    // Visual encoder: a disabled channel is honest, not an error.
    let visual_settings = if args.skip_visual {
        VisualEmbeddingSettings {
            provider: neuink_config::VisualEmbeddingProviderKind::Retired,
            ..VisualEmbeddingSettings::default()
        }
    } else {
        VisualEmbeddingSettings {
            endpoint: args.visual_endpoint.clone(),
            ..VisualEmbeddingSettings::default()
        }
    };
    let provider = provider_for(&visual_settings);
    let mut visual_prepare = serde_json::Value::Null;
    if args.prepare_visual && !args.skip_visual {
        let prepare_started = Instant::now();
        match prepare_visual_index(
            provider.clone(),
            PrepareVisualSearchIndexRequest {
                root: args.root.clone(),
            },
        ) {
            Ok(response) => {
                visual_prepare = serde_json::json!({
                    "status": "prepared",
                    "entry_count": response.entry_count,
                    "asset_count": response.asset_count,
                    "document_count": response.document_count,
                    "embedded_count": response.embedded_count,
                    "ms": prepare_started.elapsed().as_millis() as u64,
                })
            }
            Err(error) => {
                // A failed prepare must not hide the retrieval result below.
                visual_prepare = serde_json::json!({ "status": "failed", "message": error })
            }
        }
    }
    report.insert("visual_prepare".to_string(), visual_prepare);

    let rerank_settings = RerankSettings {
        mode: args.rerank_mode,
        model_dir: args
            .rerank_dir
            .as_ref()
            .map(|dir| dir.to_string_lossy().to_string()),
        ..RerankSettings::default()
    };
    let rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>> =
        if args.rerank_mode == RerankMode::CrossEncoder {
            args.rerank_dir
                .as_deref()
                .and_then(rerank_stage::reranker_for)
                .map(|reranker| reranker as Arc<dyn neuink_search::RerankProvider>)
        } else {
            None
        };
    report.insert(
        "rerank".to_string(),
        serde_json::json!({
            "requested": rerank_settings.mode.as_str(),
            "provider_loaded": rerank_provider.is_some(),
            "max_candidates": rerank_settings.max_candidates,
        }),
    );


    // Optional: build the text index first, so a probe run on a fresh library exercises
    // the same semantic channel the app would use.
    if args.build_text_index {
        let build_started = Instant::now();
        let built = neuink_ipc::commands::search::rebuild_search_index_impl(
            args.model_dir.clone(),
            neuink_ipc::commands::search::RebuildSearchIndexRequest {
                root: args.root.clone(),
                segments_only: true,
            },
        )?;
        report.insert(
            "text_index".to_string(),
            serde_json::json!({
                "status": "built",
                "rebuilt_vector_count": built.rebuilt_vector_count,
                "semantic_status": format!("{:?}", built.status.semantic_status),
                "ms": build_started.elapsed().as_millis() as u64,
            }),
        );
    }
    // Surface why semantic retrieval did or did not run: a probe that hides the text
    // encoder state cannot explain a `hybrid_fallback_keyword` result.
    let text_provider = neuink_search::FastEmbedProvider::from_model_dir(args.model_dir.clone());
    let text_status = neuink_search::EmbeddingProvider::status(&text_provider);
    report.insert(
        "text_model".to_string(),
        serde_json::json!({
            "available": text_status.available,
            "dimensions": text_status.dimensions,
            "model_name": text_status.model_name,
            "message": text_status.message,
            "dir": args.model_dir.to_string_lossy(),
        }),
    );
    let retrieval_started = Instant::now();
    let response = run_unified_search(
        args.model_dir.clone(),
        provider,
        neuink_config::VisualFusionSettings::default(),
        rerank_settings,
        rerank_provider,
        UnifiedSearchRequest {
            root: args.root.clone(),
            question: args.question.clone(),
            sub_questions: args.sub_questions.clone(),
            scope_entry_ids: Vec::new(),
            mandated_entry_ids: Vec::new(),
            section_filter: None,
            segment_types: Vec::new(),
            mode: neuink_search::SearchMode::Hybrid,
            top_k: Some(args.top_k),
            head_units: None,
            max_documents: None,
            bind_carriers: None,
        },
    )?;
    let retrieval_ms = retrieval_started.elapsed().as_millis() as u64;

    report.insert("question".to_string(), serde_json::json!(response.question));
    report.insert(
        "routing".to_string(),
        serde_json::json!({
            "documents": response.routed_documents,
            "skip": response.routing_skip,
            "truncated": response.truncated,
            "text_entries": response.text_entries,
            "visual_entries": response.visual_entries,
            "visual_status": response.visual_status,
            "visual_gate_open": response.visual_gate_open,
        }),
    );
    report.insert(
        "carriers".to_string(),
        serde_json::json!(response
            .carriers
            .iter()
            .map(|carrier| serde_json::json!({ "kind": carrier.kind, "label": carrier.label }))
            .collect::<Vec<_>>()),
    );
    report.insert(
        "degradations".to_string(),
        serde_json::json!(response.degradations),
    );
    report.insert(
        "tasks".to_string(),
        serde_json::json!(response
            .tasks
            .iter()
            .map(|task| serde_json::json!({
                "question": task.question,
                "carrier_applied": task.carrier_applied,
                "mode": task.mode,
                "hits": task.total_hit_count,
                "rerank_used": task.rerank_used,
                "rerank_reason": task.rerank_reason,
                "top": neuink_search::ordered_hits(&task.results)
                    .into_iter()
                    .take(3)
                    .map(|hit| serde_json::json!({
                        "entry": hit.entry_id.to_string(),
                        "snippet": hit.snippet.chars().take(120).collect::<String>(),
                    }))
                    .collect::<Vec<_>>(),
            }))
            .collect::<Vec<_>>()),
    );
    report.insert(
        "timing_ms".to_string(),
        serde_json::json!({
            "retrieval": retrieval_ms,
            "total": started.elapsed().as_millis() as u64,
        }),
    );

    println!(
        "{}",
        serde_json::to_string_pretty(&serde_json::Value::Object(report))
            .map_err(|error| error.to_string())?
    );
    Ok(())
}





