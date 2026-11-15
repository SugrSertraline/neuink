use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::reranking::*;

fn unique_dir(prefix: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("{prefix}-{}-{nanos}", std::process::id()))
}

#[test]
fn rerank_load_missing_directory_maps_to_fixed_message_without_path() {
    let dir = unique_dir("neuink-rerank-missing");

    let error = LocalReranker::load(&dir)
        .err()
        .expect("missing dir must fail");

    assert_eq!(
        error,
        RerankError::ModelUnavailable("reranker model directory is missing")
    );
    assert!(!error.to_string().contains(&dir.display().to_string()));
}

#[test]
fn rerank_load_missing_tokenizer_asset_fails_without_path_leak() {
    let dir = unique_dir("neuink-rerank-no-tokenizer");
    fs::create_dir_all(dir.join("onnx")).unwrap();
    fs::write(dir.join("onnx").join("model.onnx"), b"not-a-real-model").unwrap();

    let error = LocalReranker::load(&dir)
        .err()
        .expect("missing tokenizer must fail");

    assert_eq!(
        error,
        RerankError::ModelUnavailable("reranker tokenizer asset is missing or unreadable")
    );
    assert!(!error.to_string().contains(&dir.display().to_string()));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn rerank_load_directory_without_onnx_file_fails_explicitly() {
    let dir = unique_dir("neuink-rerank-no-onnx");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("tokenizer.json"), b"{}").unwrap();

    let error = LocalReranker::load(&dir)
        .err()
        .expect("missing onnx must fail");

    assert_eq!(
        error,
        RerankError::ModelUnavailable("reranker ONNX model file is missing")
    );
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn rerank_load_recognizes_pinned_int8_model_file() {
    let dir = unique_dir("neuink-rerank-int8");
    fs::create_dir_all(dir.join("onnx")).unwrap();
    fs::write(
        dir.join("onnx").join("model_int8.onnx"),
        b"not-a-real-model",
    )
    .unwrap();

    // File discovery succeeds, so the failure comes from the missing tokenizer.
    let error = LocalReranker::load(&dir)
        .err()
        .expect("missing tokenizer must fail");

    assert_eq!(
        error,
        RerankError::ModelUnavailable("reranker tokenizer asset is missing or unreadable")
    );
    assert!(!error.to_string().contains(&dir.display().to_string()));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn rerank_load_rejects_out_of_range_options_before_reading_model() {
    // The directory is missing. Only validation can produce InvalidOptions here.
    let dir = unique_dir("neuink-rerank-bad-options");
    let cases = [
        (
            LocalRerankerOptions {
                intra_threads: Some(0),
                batch_size: 8,
            },
            "intra_threads",
            0,
            64,
        ),
        (
            LocalRerankerOptions {
                intra_threads: Some(65),
                batch_size: 8,
            },
            "intra_threads",
            65,
            64,
        ),
        (
            LocalRerankerOptions {
                intra_threads: None,
                batch_size: 0,
            },
            "batch_size",
            0,
            32,
        ),
        (
            LocalRerankerOptions {
                intra_threads: None,
                batch_size: 33,
            },
            "batch_size",
            33,
            32,
        ),
    ];

    for (options, field, requested, max) in cases {
        let error = LocalReranker::load_with_options(&dir, options)
            .err()
            .expect("out-of-range options must fail");

        assert_eq!(
            error,
            RerankError::InvalidOptions {
                field,
                requested,
                max
            }
        );
        assert!(!error.to_string().contains(&dir.display().to_string()));
    }
}

#[test]
fn rerank_load_accepts_option_bounds_and_reaches_model_check() {
    let dir = unique_dir("neuink-rerank-option-bounds");
    let bounds = [
        LocalRerankerOptions {
            intra_threads: Some(1),
            batch_size: 1,
        },
        LocalRerankerOptions {
            intra_threads: Some(64),
            batch_size: 32,
        },
    ];

    for options in bounds {
        // Validation passes, so the failure comes from the missing model directory.
        let error = LocalReranker::load_with_options(&dir, options)
            .err()
            .expect("missing dir must fail");

        assert_eq!(
            error,
            RerankError::ModelUnavailable("reranker model directory is missing")
        );
    }
}

fn real_model_dir() -> PathBuf {
    let model_dir = std::env::var_os("NEUINK_RERANKER_MODEL_DIR").unwrap_or_else(|| {
        panic!(
            "NEUINK_RERANKER_MODEL_DIR must be set to a local reranker model directory \
             when running this ignored test; the test was not executed"
        )
    });
    PathBuf::from(model_dir)
}

/// Two-passage check against a real ONNX session. The relevant passage must rank first.
fn assert_prefers_paris(reranker: &LocalReranker) {
    let input = vec![
        RerankCandidate {
            id: "berlin".to_string(),
            text: "Berlin is the largest city in Germany.".to_string(),
        },
        RerankCandidate {
            id: "paris".to_string(),
            text: "Paris is the capital of France.".to_string(),
        },
    ];

    let ordered =
        rerank_candidates(reranker, "What is the capital of France?", &input, 10).unwrap();

    assert_eq!(ordered.len(), 2);
    assert_eq!(ordered[0].id, "paris");
    assert!(ordered.iter().all(|item| item.score.is_finite()));
}

/// Runs only when `NEUINK_RERANKER_MODEL_DIR` points at a local reranker
/// directory. Nothing is downloaded. Run with:
/// `cargo test -p neuink-search --lib rerank --features local-embedding -- --ignored`
#[test]
#[ignore = "requires NEUINK_RERANKER_MODEL_DIR pointing at a local reranker model"]
fn rerank_real_onnx_model_prefers_relevant_passage() {
    let reranker = LocalReranker::load(&real_model_dir()).unwrap();

    assert_prefers_paris(&reranker);
}

/// Same check with explicit thread and batch settings, through the validated load path.
#[test]
#[ignore = "requires NEUINK_RERANKER_MODEL_DIR pointing at a local reranker model"]
fn rerank_real_onnx_model_accepts_explicit_threads_and_batch() {
    let options = LocalRerankerOptions {
        intra_threads: Some(4),
        batch_size: 4,
    };
    let reranker = LocalReranker::load_with_options(&real_model_dir(), options).unwrap();

    assert_prefers_paris(&reranker);
}
