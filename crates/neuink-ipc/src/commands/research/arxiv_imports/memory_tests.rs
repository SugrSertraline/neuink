use super::tests::{fixture, read, selection};
use super::*;
use crate::commands::research::{self, Paper};
#[test]
fn split_cache_memory_observation() {
    fn heap(p: &Paper) -> usize {
        [
            &p.id,
            &p.title,
            &p.year,
            &p.abstract_text,
            &p.doi,
            &p.url,
            &p.provider,
            &p.evidence_level,
        ]
        .iter()
        .map(|s| s.capacity())
        .sum::<usize>()
            + p.pdf_url.as_ref().map_or(0, |s| s.capacity())
            + p.authors.capacity() * std::mem::size_of::<String>()
            + p.authors.iter().map(String::capacity).sum::<usize>()
    }
    fn extra(p: &ArxivPaper) -> usize {
        [
            &p.arxiv.base_id,
            &p.arxiv.primary_category,
            &p.arxiv.published,
            &p.arxiv.updated,
            &p.arxiv.comment,
            &p.arxiv.journal_ref,
        ]
        .iter()
        .map(|s| s.as_ref().map_or(0, |s| s.capacity()))
        .sum::<usize>()
            + p.arxiv.categories.as_ref().map_or(0, |v| {
                v.capacity() * std::mem::size_of::<String>()
                    + v.iter().map(String::capacity).sum::<usize>()
            })
    }
    fn rss() -> Option<u64> {
        #[cfg(windows)]
        {
            let script = format!("(Get-Process -Id {}).WorkingSet64", std::process::id());
            let mut cmd = std::process::Command::new("powershell.exe");
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
            return cmd
                .args(["-NoProfile", "-Command", &script])
                .output()
                .ok()
                .and_then(|v| String::from_utf8(v.stdout).ok())
                .and_then(|v| v.trim().parse().ok());
        }
        #[cfg(not(windows))]
        {
            None
        }
    }
    let (_dir, root, mut p, mut a) = fixture();
    for (name, size) in [("typical", 4096), ("long", 64 * 1024)] {
        p.abstract_text = "x".repeat(size);
        a.abstract_text = "研究".repeat(size / 6);
        let before = rss();
        let old: Vec<_> = (0..512)
            .map(|i| {
                let mut x = p.clone();
                x.id = format!("legacy-{i}");
                x
            })
            .collect();
        let new: Vec<_> = (0..512)
            .map(|i| {
                let mut x = a.clone();
                x.id = format!("arxiv-{i}");
                x
            })
            .collect();
        let single_old = serde_json::to_vec(&old[0]).unwrap().len();
        let single_new = serde_json::to_vec(&new[0]).unwrap().len();
        research::remember(&root, &old).unwrap();
        arxiv_cache::remember(&root, &new).unwrap();
        drop(old);
        drop(new);
        let old_bytes = {
            let rows = research::cache().lock().unwrap();
            rows.capacity() * std::mem::size_of::<research::CachedPaper>()
                + rows
                    .iter()
                    .map(|r| heap(&r.paper) + r.root.capacity())
                    .sum::<usize>()
        };
        let new_bytes = {
            let rows = arxiv_cache::cache().lock().unwrap();
            rows.capacity() * std::mem::size_of::<arxiv_cache::CachedPaper>()
                + rows
                    .iter()
                    .map(|r| heap(&r.paper.clone().into()) + extra(&r.paper) + r.root.capacity())
                    .sum::<usize>()
        };
        let after = rss();
        // Preview and approval clones are measured separately; they do not enlarge cache capacity.
        let selection = vec![selection("arxiv-511", PaperCacheSource::ArxivSearch)];
        let preview = read(&root, &selection);
        let clone_bytes = serde_json::to_vec(&preview).unwrap().len();
        println!(
            "CACHE_SPLIT_JSON {}",
            serde_json::json!({"case":"memory","sample":name,"per_cache_records":512,
            "single_old_json_bytes":single_old,"single_new_json_bytes":single_new,"old_owned_capacity_estimate":old_bytes,
            "new_owned_capacity_estimate":new_bytes,"rss_before":before,"rss_after":after,
            "rss_delta":after.zip(before).map(|(a,b)|a as i64-b as i64),"preview_json_bytes":clone_bytes,
            "limitations":"Owned string/vector capacity estimate excludes allocator overhead and UI/message clones; RSS is process-wide, not peak certification."})
        );
    }
}
