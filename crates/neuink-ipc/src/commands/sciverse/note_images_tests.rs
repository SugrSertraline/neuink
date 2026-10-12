use super::*;

const BASE: &str = "https://api.sciverse.space";

#[test]
fn relative_images_use_resource_storage_and_gateway_urls_extract_only_the_path() {
    let path = "dt=2026-06-07/ht=08/figure.jpg";
    for reference in [
        path.to_string(),
        format!("./{path}"),
        format!("{BASE}/resource?file_name=dt%3D2026-06-07%2Fht%3D08%2Ffigure.jpg&ignored=value"),
        format!("/resource?file_name={path}"),
    ] {
        assert_eq!(
            image_source(&reference, BASE).unwrap(),
            ImageSource::Resource(path.into())
        );
    }
    assert_eq!(
        image_source(
            "https://custom.example/api/resource?file_name=figure.jpg",
            "https://custom.example/api"
        )
        .unwrap(),
        ImageSource::Resource("figure.jpg".into())
    );
}

#[test]
fn public_urls_are_separate_from_authenticated_sciverse_resources() {
    for reference in [
        "https://images.example/figure.jpg",
        "https://images.example/resource?file_name=figure.jpg",
    ] {
        assert_eq!(
            image_source(reference, BASE).unwrap(),
            ImageSource::PublicUrl(reference.into())
        );
    }
    assert_eq!(
        image_source("http://images.example/figure.jpg", BASE).unwrap(),
        ImageSource::PublicUrl("https://images.example/figure.jpg".into())
    );
}

#[test]
fn rejects_unsafe_references_and_ambiguous_gateway_paths() {
    for reference in [
        "",
        "../a.jpg",
        "images/../a.jpg",
        "/a.jpg",
        "C:\\a.jpg",
        "file:///a.jpg",
        "https://127.0.0.1/a.jpg",
        "https://user:password@images.example/a.jpg",
        "https://api.sciverse.space/resource?doc_id=abc",
        "https://api.sciverse.space/resource?file_name=a&file_name=b",
        "https://api.sciverse.space/resource?file_name=..%2Fa.jpg",
        "data:text/html;base64,PGh0bWw+",
    ] {
        assert!(
            image_source(reference, BASE).is_err(),
            "reference should be rejected"
        );
    }
}

#[tokio::test]
async fn saves_binary_images_as_local_attachments_and_rejects_disguised_html() {
    let dir = tempfile::tempdir().unwrap();
    let workspace = Workspace::create(dir.path()).unwrap();
    let entry = workspace.create_entry("Paper").unwrap();
    let entry = workspace.create_note(&entry.id, "Full text").unwrap();
    let neuink_domain::ContentItem::Note { note_id, .. } = &entry.contents[0];
    let client = SciverseClient::new(BASE, "not-used-for-data-images").unwrap();
    let request = |reference: &str| SaveSciverseNoteImageRequest {
        root: dir.path().into(),
        entry_id: entry.id.clone(),
        note_id: note_id.clone(),
        reference: reference.into(),
    };
    let saved = save_image(&client, BASE, request("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=")).await.unwrap();
    assert!(saved
        .markdown_path
        .starts_with(&format!("./{note_id}.assets/")));
    assert!(std::fs::read(saved.file_path)
        .unwrap()
        .starts_with(b"\x89PNG\r\n\x1a\n"));
    assert!(save_image(
        &client,
        BASE,
        request("data:image/png;base64,PGh0bWw+RGVuaWVkPC9odG1sPg==")
    )
    .await
    .is_err());
    assert_eq!(
        std::fs::read_dir(workspace.layout().entry_note_assets_dir(&entry.id, note_id))
            .unwrap()
            .count(),
        1
    );
}
