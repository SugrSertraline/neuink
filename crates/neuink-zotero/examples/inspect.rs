//! Read-only smoke check: cargo run -p neuink-zotero --example inspect -- <data-directory>
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::env::args_os()
        .nth(1)
        .ok_or("Provide a Zotero data directory")?;
    let settings = neuink_zotero::SourceSettings {
        data_directory: Some(directory.into()),
        linked_attachment_directory: None,
    };
    let library = neuink_zotero::read_library(&settings)?;
    println!(
        "papers={} collections={} local_pdfs={} missing_pdfs={}",
        library.papers.len(),
        library.collections.len(),
        library
            .papers
            .iter()
            .flat_map(|p| &p.attachments)
            .filter(|a| a.available)
            .count(),
        library
            .papers
            .iter()
            .flat_map(|p| &p.attachments)
            .filter(|a| !a.available)
            .count()
    );
    Ok(())
}
