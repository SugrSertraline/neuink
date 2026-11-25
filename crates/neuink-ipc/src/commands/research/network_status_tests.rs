use super::*;

#[tokio::test]
async fn status_headers_limits_and_remote_body_sanitization() {
    let response = reqwest::Response::from(
        tauri::http::Response::builder()
            .status(429)
            .header("retry-after", "7")
            .body("token=secret")
            .unwrap(),
    );
    let response = status_response(response, 10).await.unwrap();
    assert_eq!(response.status, 429);
    assert_eq!(response.retry_after.as_deref(), Some("7"));
    assert!(response.bytes.is_empty());
    let response = reqwest::Response::from(
        tauri::http::Response::builder()
            .status(200)
            .body(vec![b'x'; 11])
            .unwrap(),
    );
    assert_eq!(
        status_response(response, 10).await.err(),
        Some("response_size_limit")
    );
    let response = reqwest::Response::from(
        tauri::http::Response::builder()
            .status(302)
            .header("location", "/api/query")
            .body("token=secret")
            .unwrap(),
    );
    let response = status_response(response, 10).await.unwrap();
    assert_eq!(response.location.as_deref(), Some("/api/query"));
    assert!(response.bytes.is_empty());
    println!(
        "STEP3_JSON {}",
        serde_json::json!({"case":"status_transport","actual":{"http":429,"retry_after":"7","error_body_bytes":0,"oversize":"response_size_limit","redirect_body_bytes":0}})
    );
}
