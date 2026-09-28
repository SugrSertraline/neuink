use super::*;
#[test]
fn bing_backup_decodes_real_urls_and_rejects_private_targets() {
    let encoded =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("https://example.org/paper");
    let html = format!(
        r#"<ol id="b_results"><li class="b_algo"><h2><a href="https://www.bing.com/ck/a?u=a1{encoded}">Paper</a></h2><div class="b_caption"><p>Abstract</p></div></li></ol>"#
    );
    let result = parse_search(&html, "bing").unwrap();
    assert_eq!(result["provider"], "bing");
    assert_eq!(result["results"][0]["url"], "https://example.org/paper");
    assert_eq!(result["results"][0]["content"], "Abstract");
    let private =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("https://127.0.0.1/private");
    assert!(parse_search(&html.replace(&encoded, &private), "bing").is_err());
    assert!(parse_search("<html>layout changed</html>", "bing").is_err());
    assert_eq!(
        parse_search("<ol id='b_results'><li class='b_no'>none</li></ol>", "bing").unwrap()
            ["results"],
        json!([])
    );
}
#[test]
fn search_decodes_links_excludes_ads_private_and_duplicates() {
    let result = parse_search(r#"<div class="result"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Farxiv.org%2Fabs%2F2603.05085">A &amp; B</a><span class="result__snippet">真实摘要</span></div>
        <div class="result result--ad"><a class="result__a" href="https://ad.example.org">ad</a></div>
        <div class="result"><a class="result__a" href="https://127.0.0.1">private</a></div>
        <div class="result"><a class="result__a" href="https://arxiv.org/abs/2603.05085">duplicate</a></div>"#, "duckduckgo").unwrap();
    assert_eq!(result["results"].as_array().unwrap().len(), 1);
    assert_eq!(result["results"][0]["title"], "A & B");
    assert_eq!(result["results"][0]["content"], "真实摘要");
}
#[test]
fn distinguishes_no_results_challenge_and_changed_markup() {
    assert!(
        parse_search("<form id='challenge-form'></form>", "duckduckgo")
            .unwrap_err()
            .contains("验证码")
    );
    assert!(parse_search("<html>blocked</html>", "duckduckgo").is_err());
    assert_eq!(
        parse_search("<div class='no-results'>none</div>", "duckduckgo").unwrap()["results"],
        json!([])
    );
}
#[test]
fn extracts_local_text_and_actual_relative_links_without_scripts() {
    let result = extract(&network::Response { url: network::public_url("https://example.org/article/").unwrap(), content_type: "text/html; charset=utf-8".into(), bytes: br#"<title>Paper</title><nav>ignore</nav><article><p>Hello <b>world</b></p><script>secret()</script><div hidden>hidden</div><a href='../paper.pdf'>PDF</a><a href='file:///secret'>local</a></article>"#.to_vec() }).unwrap();
    assert_eq!(result["results"][0]["content"], "Hello world PDF local");
    assert_eq!(
        result["results"][0]["links"][0]["url"],
        "https://example.org/paper.pdf"
    );
    assert_eq!(result["results"][0]["links"].as_array().unwrap().len(), 1);
}
#[test]
fn rejects_binary_and_bounds_unicode_text() {
    let mut response = network::Response {
        url: network::public_url("https://example.org").unwrap(),
        content_type: "application/pdf".into(),
        bytes: b"%PDF-".to_vec(),
    };
    assert!(extract(&response).is_err());
    response.content_type = "text/plain; charset=utf-8".into();
    response.bytes = "文".repeat(15000).into_bytes();
    let result = extract(&response).unwrap();
    assert_eq!(result["results"][0]["truncated"], true);
    assert_eq!(
        result["results"][0]["content"]
            .as_str()
            .unwrap()
            .chars()
            .count(),
        12000
    );
}
#[tokio::test]
#[ignore = "Public network, no keys or workspace writes"]
async fn live_keyless_web() {
    let results = search("Wire Your Way arxiv").await.unwrap();
    assert!(!results["results"].as_array().unwrap().is_empty());
    println!(
        "keyless search provider={}, results={}",
        results["provider"],
        results["results"].as_array().unwrap().len()
    );
    assert_eq!(search("Wire Your Way arxiv").await.unwrap()["cached"], true);
    let page = read("https://arxiv.org/abs/2603.05085").await.unwrap();
    assert!(page["results"][0]["content"]
        .as_str()
        .unwrap()
        .contains("Wire"));
}
