//! Local semantic signals, not permissions or an Agent executor. No network or user-text logs.
use super::embedding_resources::embedding_model_dir;
use neuink_search::{EmbeddingInput, EmbeddingProvider, EmbeddingVector, FastEmbedProvider};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};

const MODEL: &str = "intfloat/multilingual-e5-small";
// Application-owned examples, inspired by Semantic Router's utterance routes.
const ROUTES: &[(&str, &[&str])] = &[
    (
        "chat",
        &[
            "你好",
            "嗨，你好呀",
            "早上好",
            "谢谢你的帮助",
            "很高兴认识你",
            "Hello, how are you?",
            "你能做什么",
        ],
    ),
    (
        "read",
        &[
            "解释选中的段落",
            "总结这篇论文",
            "阅读论文并回答问题",
            "这篇文章的实验结果是什么",
            "翻译这段文字",
            "概括上一段",
        ],
    ),
    (
        "edit",
        &[
            "把标题改短一点",
            "删除笔记第二段",
            "给论文生成标签",
            "你好，请修改这条笔记",
            "谢谢，顺便删除第二段",
            "把主题切换为深色",
        ],
    ),
    (
        "research",
        &[
            "查找相关论文并比较方法",
            "阅读三篇论文形成带引用的笔记",
            "检索文献然后做PPT",
            "分析实验设计并整理研究报告",
        ],
    ),
    (
        "plan",
        &[
            "先给我一个方案，不要执行",
            "只做计划，暂时不要修改",
            "我们应该怎么组织阅读流程",
            "先分析修改的影响",
        ],
    ),
    (
        "other",
        &[
            "好的，继续",
            "就这样做",
            "换一种",
            "不要这样",
            "为什么",
            "按刚才说的处理",
            "你觉得呢",
        ],
    ),
];

struct RouterModel {
    path: PathBuf,
    provider: FastEmbedProvider,
    examples: Vec<EmbeddingVector>,
}
static ROUTER: OnceLock<Mutex<Option<RouterModel>>> = OnceLock::new();

#[derive(Debug, Serialize)]
pub struct RouteScore {
    route: &'static str,
    similarity: f32,
}
#[derive(Debug, Serialize)]
pub struct RouteSignals {
    status: &'static str,
    model: &'static str,
    version: u32,
    scores: Vec<RouteScore>,
}
fn unavailable(status: &'static str) -> RouteSignals {
    RouteSignals {
        status,
        model: MODEL,
        version: 1,
        scores: vec![],
    }
}

fn input(text: &str) -> EmbeddingInput {
    // E5 model card specifies query: for BOTH sides of symmetric similarity/classification.
    EmbeddingInput {
        id: String::new(),
        text: format!("query: {text}"),
    }
}
fn load_router(path: PathBuf) -> Option<RouterModel> {
    let provider = FastEmbedProvider::from_model_dir(&path);
    let status = provider.status();
    // Do not silently reuse thresholds/prefixes with a different installed encoder.
    if !status.available || status.model_name.as_deref() != Some(MODEL) {
        return None;
    }
    let inputs: Vec<_> = ROUTES
        .iter()
        .flat_map(|(_, texts)| texts.iter().map(|text| input(text)))
        .collect();
    let examples = provider.embed(&inputs).ok()?;
    if examples.len() != inputs.len() {
        return None;
    }
    Some(RouterModel {
        path,
        provider,
        examples,
    })
}
fn cosine(left: &[f32], right: &[f32]) -> Option<f32> {
    if left.is_empty() || left.len() != right.len() {
        return None;
    }
    if left.iter().chain(right).any(|value| !value.is_finite()) {
        return None;
    }
    let norm =
        (left.iter().map(|v| v * v).sum::<f32>() * right.iter().map(|v| v * v).sum::<f32>()).sqrt();
    if norm <= 0.0 || !norm.is_finite() {
        return None;
    }
    let dot: f32 = left.iter().zip(right).map(|(a, b)| a * b).sum();
    Some((dot / norm).clamp(-1.0, 1.0))
}
fn score(router: &RouterModel, text: &str) -> Option<Vec<RouteScore>> {
    let query = router.provider.embed(&[input(text)]).ok()?;
    let query = &query.first()?.values;
    let mut offset = 0;
    let mut scores = Vec::new();
    for (route, texts) in ROUTES {
        let mut best = -1.0_f32;
        for example in &router.examples[offset..offset + texts.len()] {
            best = best.max(cosine(query, &example.values)?);
        }
        offset += texts.len();
        scores.push(RouteScore {
            route,
            similarity: best,
        });
    }
    scores.sort_by(|a, b| b.similarity.total_cmp(&a.similarity));
    Some(scores)
}

/// None prewarms only. Dedicated session: document indexing cannot hold this model's lock.
#[tauri::command]
pub async fn assistant_route_signals<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    text: Option<String>,
) -> RouteSignals {
    if text
        .as_ref()
        .is_some_and(|s| s.trim().is_empty() || s.chars().count() > 256)
    {
        return unavailable("skipped");
    }
    let Ok(path) = embedding_model_dir(&app) else {
        return unavailable("unavailable");
    };
    let job = tokio::task::spawn_blocking(move || {
        // Busy requests abstain, rather than building an unbounded inference queue.
        let Ok(mut guard) = ROUTER.get_or_init(|| Mutex::new(None)).try_lock() else {
            return unavailable("busy");
        };
        if guard.as_ref().is_none_or(|model| model.path != path) {
            *guard = load_router(path);
        }
        let Some(router) = guard.as_ref() else {
            return unavailable("unavailable");
        };
        let scores = match text {
            Some(text) => match score(router, &text) {
                Some(scores) => scores,
                None => return unavailable("unavailable"),
            },
            None => vec![],
        };
        RouteSignals {
            status: "ready",
            model: MODEL,
            version: 1,
            scores,
        }
    });
    // Dropping the join handle leaves at most one warming/inference job; it can
    // populate the shared cache but can never change a running Agent's decision.
    match tokio::time::timeout(Duration::from_millis(100), job).await {
        Ok(Ok(result)) => result,
        _ => unavailable("warming"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cosine_rejects_invalid_vectors() {
        assert_eq!(cosine(&[1.0, 0.0], &[1.0, 0.0]), Some(1.0));
        assert_eq!(cosine(&[1.0, 0.0], &[0.0, 1.0]), Some(0.0));
        assert_eq!(cosine(&[], &[]), None);
        assert_eq!(cosine(&[0.0], &[1.0]), None);
        assert_eq!(cosine(&[f32::NAN], &[1.0]), None);
        assert_eq!(cosine(&[1.0], &[1.0, 2.0]), None);
    }
    #[test]
    fn missing_resources_abstain() {
        assert!(load_router(PathBuf::from("nonexistent-router-model")).is_none());
    }
    #[test]
    #[ignore = "requires bundled local ONNX model; no network or API key"]
    fn bundled_model_smoke() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../apps/desktop/src-tauri/resources/embedding-models/default");
        let started = std::time::Instant::now();
        let router = load_router(path).expect("bundled E5 model");
        eprintln!("router cold start: {:?}", started.elapsed());
        for text in [
            "你好呀",
            "谢谢，顺便删除第二段",
            "总结这篇论文",
            "好的，继续",
            "先给一个计划，不要修改",
        ] {
            let started = std::time::Instant::now();
            let scores = score(&router, text).expect("finite scores");
            assert_eq!(scores.len(), ROUTES.len());
            eprintln!(
                "fixture={text:?}, top={:?}, elapsed={:?}",
                scores[0],
                started.elapsed()
            );
        }
    }
}
