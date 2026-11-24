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

use neuink_config::{RemoteApiStyle, RerankMode, RerankSettings, RerankTransport, VisualEmbeddingSettings};
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
    seed_demo: Option<PathBuf>,
    scope_entry_ids: Vec<String>,
    rerank_api_endpoint: Option<String>,
    rerank_api_model: Option<String>,
    rerank_api_key_env: Option<String>,
    rerank_api_style: RemoteApiStyle,
    scope_refine: bool,
    scope_llm_endpoint: String,
    scope_llm_model: String,
    scope_llm_key_env: String,
    multivector_pool: Option<String>,
    rerank_api_instruction: Option<String>,
    rerank_fuse_pool: bool,
    structured_input: bool,
    structural_soft: bool,
    listwise_rerank: bool,
    listwise_no_rrf: bool,
    listwise_no_single_paper: bool,
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
    let mut seed_demo: Option<PathBuf> = None;
    let mut scope_entry_ids = Vec::new();
    let mut rerank_api_endpoint = None;
    let mut rerank_api_model = None;
    let mut rerank_api_key_env = None;
    let mut rerank_api_style = RemoteApiStyle::Protocol;
    let mut scope_refine = false;
    let mut scope_llm_endpoint = "https://api.siliconflow.cn/v1".to_string();
    let mut scope_llm_model = "deepseek-ai/DeepSeek-V4.1-Flash".to_string();
    let mut scope_llm_key_env = "SILICONFLOW_API_KEY".to_string();
    let mut multivector_pool = None;
    let mut rerank_api_instruction = None;
    let mut rerank_fuse_pool = false;
    let mut structured_input = false;
    let mut structural_soft = false;
    let mut listwise_rerank = false;
    let mut listwise_no_rrf = false;
    let mut listwise_no_single_paper = false;

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
            "--seed-demo" => seed_demo = Some(PathBuf::from(value()?)),
            "--scope-entry" => scope_entry_ids.push(value()?),
            "--rerank-api-endpoint" => rerank_api_endpoint = Some(value()?),
            "--rerank-api-model" => rerank_api_model = Some(value()?),
            "--rerank-api-key-env" => rerank_api_key_env = Some(value()?),
            "--rerank-api-style" => {
                rerank_api_style = match value()?.as_str() {
                    "protocol" => RemoteApiStyle::Protocol,
                    "dashscope" => RemoteApiStyle::DashScope,
                    other => return Err(format!("unknown rerank api style: {other}")),
                }
            }
            "--scope-refine" => scope_refine = true,
            "--scope-llm-endpoint" => scope_llm_endpoint = value()?,
            "--scope-llm-model" => scope_llm_model = value()?,
            "--scope-llm-key-env" => scope_llm_key_env = value()?,
            "--multivector-pool" => multivector_pool = Some(value()?),
            "--rerank-api-instruction" => rerank_api_instruction = Some(value()?),
            "--rerank-fuse-pool" => rerank_fuse_pool = true,
            "--structured-input" => structured_input = true,
            "--structural-soft" => structural_soft = true,
            "--listwise-rerank" => listwise_rerank = true,
            "--listwise-no-rrf" => listwise_no_rrf = true,
            "--listwise-no-single-paper" => listwise_no_single_paper = true,
            "--help" | "-h" => {
                println!(
                    "retrieval-probe --root DIR --model-dir DIR --question TEXT \
                     [--sub-question TEXT]... [--top-k N] [--scope-entry ID]... \
                     [--multivector-pool off|colbert|bge_m3_hybrid] \
                     [--rerank-mode off|heuristic|cross_encoder] [--rerank-dir DIR] \
                     [--rerank-api-endpoint URL] [--rerank-api-model NAME] \
                     [--rerank-api-key-env VAR] [--rerank-api-style protocol|dashscope] \
                     [--rerank-api-instruction TEXT] [--rerank-fuse-pool] \
                     [--structured-input] [--structural-soft] \
                     [--scope-refine] [--listwise-rerank] [--listwise-no-rrf] [--listwise-no-single-paper] \
                     [--scope-llm-endpoint URL] [--scope-llm-model NAME] [--scope-llm-key-env VAR] \
                     [--visual-endpoint URL] [--skip-visual] [--prepare-visual]"
                );
                std::process::exit(0);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    let root = root.or_else(|| seed_demo.clone());
    let model_dir = model_dir.or_else(|| {
        Some(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../apps/desktop/src-tauri/resources/embedding-models/default"),
        )
    });
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
        seed_demo,
        scope_entry_ids,
        rerank_api_endpoint,
        rerank_api_model,
        rerank_api_key_env,
        rerank_api_style,
        scope_refine,
        scope_llm_endpoint,
        scope_llm_model,
        scope_llm_key_env,
        multivector_pool,
        rerank_api_instruction,
        rerank_fuse_pool,
        structured_input,
        structural_soft,
        listwise_rerank,
        listwise_no_rrf,
        listwise_no_single_paper,
    })
}

fn env_secret(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.trim().is_empty())
}


/// Materializes a two-paper fixture library so the multi-document path (routing, visual
/// votes, carrier binding) can be exercised without importing real papers.
///
/// It refuses to touch an existing non-empty directory: a probe must never be able to
/// overwrite a real library.
fn seed_demo(dir: &std::path::Path) -> Result<(), String> {
    use neuink_domain::{SegmentType, SourceSegment};
    use neuink_workspace::Workspace;

    if dir.is_dir() && std::fs::read_dir(dir).map_err(|e| e.to_string())?.next().is_some() {
        return Err(format!(
            "{} is not empty; refusing to seed a demo library there",
            dir.display()
        ));
    }
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    let workspace = Workspace::create(dir).map_err(|error| error.to_string())?;

    let papers: [(&str, &[(&str, SegmentType, u32, &str)]); 2] = [
        (
            "Dense Retrieval Notes",
            &[
                ("Section 3 describes the dual-channel retriever and its fusion rule.", SegmentType::Paragraph, 0, ""),
                ("Table 3 reports recall@10 of 0.475 for the fused channel and 0.380 for text only.", SegmentType::Table, 1, "images/table3.jpg"),
                ("Figure 2 plots recall against candidate depth for both channels.", SegmentType::Figure, 2, "images/figure2.jpg"),
            ],
        ),
        (
            "Table Parsing Study",
            &[
                ("We annotate 1,193 two-hop questions and 311 three-hop questions.", SegmentType::Paragraph, 0, ""),
                ("Table 1 lists parser accuracy of 44.9% on the held-out split.", SegmentType::Table, 1, "images/table1.jpg"),
                ("Figure 1 shows the annotation interface used by three annotators.", SegmentType::Figure, 2, "images/figure1.jpg"),
            ],
        ),
    ];

    for (title, rows) in papers {
        let entry = workspace.create_entry(title).map_err(|e| e.to_string())?;
        let pdf_path = dir.join(format!("{title}.pdf"));
        std::fs::write(&pdf_path, b"%PDF-1.4\n%%EOF\n").map_err(|e| e.to_string())?;
        workspace
            .import_pdf(&entry.id, &pdf_path)
            .map_err(|e| e.to_string())?;
        for status in [
            neuink_domain::PdfParseStatus::Queued,
            neuink_domain::PdfParseStatus::Uploading,
            neuink_domain::PdfParseStatus::Uploaded,
            neuink_domain::PdfParseStatus::Parsing,
            neuink_domain::PdfParseStatus::Succeeded,
        ] {
            workspace
                .set_pdf_parse_state(&entry.id, status, None)
                .map_err(|e| e.to_string())?;
        }
        let segments = rows
            .iter()
            .map(|(text, kind, page, asset)| {
                SourceSegment::new(*kind, *page, None, (*text).to_string())
                    .with_asset_path((!asset.is_empty()).then(|| (*asset).to_string()))
            })
            .collect::<Vec<_>>();
        workspace
            .write_segments(&entry.id, &segments)
            .map_err(|e| e.to_string())?;

        // One MinerU archive per paper: the images the figure/table channel reads.
        let zip_bytes = {
            use std::io::{Cursor, Write};
            use zip::{write::SimpleFileOptions, ZipWriter};
            let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
            writer
                .start_file("content_list.json", SimpleFileOptions::default())
                .map_err(|e| e.to_string())?;
            writer.write_all(b"[]").map_err(|e| e.to_string())?;
            for (_, _, _, asset) in rows {
                if asset.is_empty() {
                    continue;
                }
                writer
                    .start_file(*asset, SimpleFileOptions::default())
                    .map_err(|e| e.to_string())?;
                writer
                    .write_all(format!("{title}-{asset}").as_bytes())
                    .map_err(|e| e.to_string())?;
            }
            writer.finish().map_err(|e| e.to_string())?.into_inner()
        };
        workspace
            .write_mineru_output_zip(&entry.id, &zip_bytes)
            .map_err(|e| e.to_string())?;
        std::fs::remove_file(&pdf_path).ok();
    }
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!("retrieval-probe: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    if let Some(dir) = args.seed_demo.as_ref() {
        seed_demo(dir)?;
    }
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

    let mut rerank_settings = RerankSettings {
        mode: args.rerank_mode,
        model_dir: args
            .rerank_dir
            .as_ref()
            .map(|dir| dir.to_string_lossy().to_string()),
        ..RerankSettings::default()
    };
    if args.rerank_api_endpoint.is_some() || args.rerank_api_model.is_some() || args.rerank_api_key_env.is_some() {
        rerank_settings.transport = RerankTransport::Api;
        rerank_settings.api_endpoint = args.rerank_api_endpoint.clone();
        rerank_settings.api_model = args.rerank_api_model.clone();
        rerank_settings.api_style = args.rerank_api_style;
        if let Some(name) = args.rerank_api_key_env.as_deref() {
            rerank_settings.api_key = env_secret(name);
        }
    }
    if args.rerank_fuse_pool {
        rerank_settings.fuse_with_pool = true;
    }
    if args.structured_input {
        rerank_settings.structured_input = true;
    }
    if args.structural_soft {
        rerank_settings.structural_soft_demotion = true;
    }
    if let Some(instruction) = args.rerank_api_instruction.clone() {
        rerank_settings.api_instruction = Some(instruction);
    }
    if args.listwise_rerank {
        rerank_settings.listwise.enabled = true;
        rerank_settings.listwise.fuse_rrf = !args.listwise_no_rrf;
        rerank_settings.listwise.single_paper_mode = !args.listwise_no_single_paper;
        rerank_settings.listwise.use_assistant_llm = false;
        rerank_settings.listwise.api_endpoint = Some(args.scope_llm_endpoint.clone());
        rerank_settings.listwise.api_model = Some(args.scope_llm_model.clone());
        rerank_settings.listwise.api_key = env_secret(&args.scope_llm_key_env);
    }
    let mut multivector = neuink_config::MultivectorPoolSettings::default();
    if let Some(mode) = args.multivector_pool.as_deref() {
        multivector.enabled = true;
        multivector.mode = match mode {
            "colbert" => neuink_config::MultivectorPoolMode::Colbert,
            "off" => {
                multivector.enabled = false;
                neuink_config::MultivectorPoolMode::BgeM3Hybrid
            }
            "bge_m3_hybrid" => neuink_config::MultivectorPoolMode::BgeM3Hybrid,
            other => return Err(format!("unknown multivector pool: {other}")),
        };
    }
    if args.scope_refine {
        rerank_settings.scope_refine.enabled = true;
        rerank_settings.scope_refine.use_assistant_llm = false;
        rerank_settings.scope_refine.api_endpoint = Some(args.scope_llm_endpoint.clone());
        rerank_settings.scope_refine.api_model = Some(args.scope_llm_model.clone());
        rerank_settings.scope_refine.api_key = env_secret(&args.scope_llm_key_env);
    }
    let rerank_dir = args.rerank_dir.clone().unwrap_or_else(|| PathBuf::from("unused"));
    let rerank_provider: Option<Arc<dyn neuink_search::RerankProvider>> =
        if args.rerank_mode == RerankMode::CrossEncoder {
            rerank_stage::provider_for(&rerank_settings, &rerank_dir)
        } else {
            None
        };
    let scope_judge = rerank_stage::scope_judge_for(&rerank_settings, None)
        .map(|judge| Arc::new(judge) as Arc<dyn neuink_search::ScopeJudgeProvider>);
    let listwise = rerank_stage::listwise_reranker_for(&rerank_settings, None)
        .map(|reranker| reranker as Arc<dyn neuink_search::ListwiseRerankProvider>);
    report.insert(
        "rerank".to_string(),
        serde_json::json!({
            "requested": rerank_settings.mode.as_str(),
            "provider_loaded": rerank_provider.is_some(),
            "max_candidates": rerank_settings.max_candidates,
            "transport": rerank_settings.transport.as_str(),
            "scope_refine": rerank_settings.scope_refine.enabled,
            "scope_judge_loaded": scope_judge.is_some(),
            "listwise": rerank_settings.listwise.enabled,
            "listwise_loaded": listwise.is_some(),
            "structured_input": rerank_settings.structured_input,
            "structural_soft": rerank_settings.structural_soft_demotion,
        }),
    );
    let text_provider: Arc<dyn neuink_search::EmbeddingProvider> =
        Arc::new(neuink_search::FastEmbedProvider::from_model_dir(
            args.model_dir.clone(),
        ));
    // Optional: build the text index first, so a probe run on a fresh library exercises
    // the same semantic channel the app would use.
    if args.build_text_index {
        let build_started = Instant::now();
        let built = neuink_ipc::commands::search::rebuild_search_index_impl(
            text_provider.clone(),
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
    let text_status = neuink_search::EmbeddingProvider::status(text_provider.as_ref());
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
        text_provider,
        provider,
        neuink_config::VisualFusionSettings::default(),
        rerank_settings,
        rerank_provider,
        scope_judge,
        listwise,
        multivector,
        UnifiedSearchRequest {
            root: args.root.clone(),
            question: args.question.clone(),
            routing_question: None,
            english_query: None,
            sub_questions: args.sub_questions.clone(),
            scope_entry_ids: args
                .scope_entry_ids
                .iter()
                .map(|id| neuink_domain::EntryId::from_string(id.clone()))
                .collect(),
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
                "visual_evidence_applied": task.visual_evidence_applied,
                "mode": task.mode,
                "hits": task.total_hit_count,
                "rerank_used": task.rerank_used,
                "rerank_reason": task.rerank_reason,
                "pool_used": task.pool_used,
                "pool_reason": task.pool_reason,
                "scope_swaps": task.scope_swaps,
                "top": neuink_search::ordered_hits(&task.results)
                    .into_iter()
                    .take(10)
                    .map(|hit| serde_json::json!({
                        "entry": hit.entry_id.to_string(),
                        "segment_uid": match &hit.target {
                            neuink_search::SearchTarget::Segment { segment_uid, .. } => segment_uid.to_string(),
                            _ => String::new(),
                        },
                        "section_path": hit.source.section_path,
                        "score": hit.score,
                        "snippet": hit.snippet,
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








