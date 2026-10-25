use super::*;
use serde_json::json;

#[tokio::test]
#[ignore = "Explicit live image diagnostic; writes source text only to the requested temporary directory"]
async fn inspect_configured_images() {
    let doc_id = std::env::var("NEUINK_SCIVERSE_TEST_DOC_ID").expect("explicit paper required");
    let output = std::path::PathBuf::from(
        std::env::var("NEUINK_SCIVERSE_IMAGE_PROBE_DIR").expect("explicit output required"),
    );
    let token = env_token()
        .or_else(|| read_credential().ok().flatten())
        .expect("configured credential required");
    let client = SciverseClient::new(DEFAULT_SCIVERSE_BASE_URL, token).unwrap();
    let content = client
        .content(&ContentRequest {
            doc_id: doc_id.clone(),
            offset: None,
            limit: None,
        })
        .await
        .unwrap();
    std::fs::create_dir_all(&output).unwrap();
    std::fs::write(output.join("source.md"), &content.text).unwrap();
    let mut offset = 0;
    let mut paged = String::new();
    for _ in 0..256 {
        let page = client
            .content(&ContentRequest {
                doc_id: doc_id.clone(),
                offset: Some(offset),
                limit: Some(16_000),
            })
            .await
            .unwrap();
        println!(
            "page start={}, next={}, declared chars={}, actual chars={}",
            offset,
            page.next_offset,
            page.chars_returned,
            page.text.chars().count()
        );
        paged.push_str(&page.text);
        if !page.more {
            break;
        }
        assert!(page.next_offset > offset);
        offset = page.next_offset;
    }
    std::fs::write(output.join("paged.md"), &paged).unwrap();
    println!(
        "paginated content matches full response={}",
        paged == content.text
    );
    let references: Vec<_> = content
        .text
        .lines()
        .filter_map(|line| {
            line.split_once("](")
                .and_then(|(_, rest)| rest.split_once(')').map(|(url, _)| url))
        })
        .collect();
    println!(
        "source chars={}, image references={}, more={}",
        content.text.chars().count(),
        references.len(),
        content.more
    );
    if let Some(reference) = references.first() {
        println!(
            "first image relative={}, extension={:?}",
            reqwest::Url::parse(reference).is_err(),
            std::path::Path::new(reference).extension()
        );
        let resource = client.resource(reference).await.unwrap();
        println!(
            "resource content_type={:?}, bytes={}",
            resource.content_type,
            resource.bytes.len()
        );
        std::fs::write(output.join("first-image.bin"), &resource.bytes).unwrap();
    }
}

#[tokio::test]
#[ignore = "Explicit live Sciverse diagnostic; uses configured credentials and public paper identifiers"]
async fn inspect_configured_paper() {
    let doc_id = std::env::var("NEUINK_SCIVERSE_TEST_DOC_ID").expect("explicit paper required");
    let title = std::env::var("NEUINK_SCIVERSE_TEST_TITLE").expect("explicit title required");
    let token = env_token()
        .or_else(|| read_credential().ok().flatten())
        .expect("configured credential required");
    let client = SciverseClient::new(DEFAULT_SCIVERSE_BASE_URL, token).unwrap();
    let catalog = client.meta_catalog().await.unwrap();
    let fields = catalog["fields"].as_array().unwrap();
    println!(
        "catalog field count={}, file_name listed={}",
        fields.len(),
        fields
            .iter()
            .any(|v| v["name"] == "file_name" || v["field"] == "file_name")
    );
    let old = client.meta_search(&json!({"query":title,"fields":["title","doc_id","doi","author","abstract","publication_published_year","publication_venue_name_unified","access_oa_url","access_license","locations","file_name"],"page_size":10})).await;
    println!(
        "legacy query status={}",
        old.as_ref()
            .err()
            .and_then(|e| e.status())
            .map(|s| s.as_u16().to_string())
            .unwrap_or_else(|| "ok".into())
    );
    let result = client.meta_search(&json!({"filters":[{"field":"doc_id","operator":"FILTER_OP_EQ","value":doc_id}],"page_size":2})).await.unwrap();
    for item in result["results"].as_array().unwrap() {
        println!(
            "matched title={}, year={}, doi={}",
            item["title"], item["publication_published_year"], item["doi"]
        );
        let mut urls = vec![];
        paper_import::collect_open_access_pdf_urls(item, &mut urls);
        println!("public PDF candidates={}", urls.len());
    }
}

#[tokio::test]
#[ignore = "Explicit live download using configured credentials; no library writes"]
async fn download_configured_paper() {
    let token = env_token()
        .or_else(|| read_credential().ok().flatten())
        .expect("configured credential required");
    let client = SciverseClient::new(DEFAULT_SCIVERSE_BASE_URL, token).unwrap();
    let result = paper_import::prepare_paper_import(
        Some(&client),
        PrepareSciversePaperImportRequest {
            doc_id: std::env::var("NEUINK_SCIVERSE_TEST_DOC_ID").expect("explicit paper required"),
            title: std::env::var("NEUINK_SCIVERSE_TEST_TITLE").expect("explicit title required"),
            doi: None,
            access_oa_url: None,
            resource_file_name: None,
        },
    )
    .await
    .unwrap();
    let path = result
        .pdf_path
        .unwrap_or_else(|| panic!("{}", result.degradation_reason.unwrap_or_default()));
    let bytes = std::fs::read(&path).unwrap();
    assert!(pdf_download::looks_like_pdf(&bytes));
    println!(
        "downloaded bytes={}, publication year={:?}, source host={}",
        bytes.len(),
        result.publication_year,
        result
            .pdf_source_url
            .and_then(|u| reqwest::Url::parse(&u).ok())
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_default()
    );
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
#[ignore = "Manual verification ONLY: explicitly requested local entry; attaches its PDF using the production service"]
async fn fetch_requested_local_entry_pdf() {
    let root = std::env::var("NEUINK_PDF_FETCH_ROOT").expect("explicit destination required");
    let id: neuink_domain::EntryId =
        serde_json::from_value(json!(std::env::var("NEUINK_PDF_FETCH_ENTRY_ID").unwrap())).unwrap();
    let workspace = neuink_workspace::Workspace::open_existing(&root).unwrap();
    let before = workspace.read_entry(&id).unwrap();
    assert_eq!(
        before.title,
        std::env::var("NEUINK_SCIVERSE_TEST_TITLE").unwrap()
    );
    assert_eq!(
        before.fields["Sciverse 文档 ID"],
        std::env::var("NEUINK_SCIVERSE_TEST_DOC_ID").unwrap()
    );
    let token = env_token()
        .or_else(|| read_credential().ok().flatten())
        .expect("configured credential required");
    let client = SciverseClient::new(DEFAULT_SCIVERSE_BASE_URL, token).unwrap();
    let after = saved_entry::fetch_saved_entry(
        &saved_entry::FetchEntryPdfRequest {
            root: root.into(),
            entry_id: id.clone(),
        },
        Some(&client),
    )
    .await
    .unwrap();
    assert!(after.pdf.is_some());
    assert_eq!(after.contents, before.contents);
    assert_eq!(after.tags, before.tags);
    for (key, value) in before.fields {
        assert_eq!(after.fields[&key], value);
    }
    let bytes = std::fs::read(workspace.layout().entry_pdf_file(&id)).unwrap();
    assert!(pdf_download::looks_like_pdf(&bytes));
    println!(
        "Requested entry PDF attached; bytes={}, original notes and fields preserved",
        bytes.len()
    );
}
