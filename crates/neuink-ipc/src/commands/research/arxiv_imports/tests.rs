use super::*;
use crate::commands::research::{self, arxiv_paper::ArxivMetadata, Paper};

pub(super) fn fixture() -> (tempfile::TempDir, PathBuf, Paper, ArxivPaper) {
    let dir = tempfile::tempdir().unwrap();
    neuink_workspace::Workspace::create(dir.path()).unwrap();
    let root = dir.path().canonicalize().unwrap();
    let p = Paper {
        id: "arxiv:2401.00001v2".into(),
        title: "Legacy".into(),
        authors: vec!["A".into()],
        year: "2024".into(),
        abstract_text: "Short".into(),
        doi: "".into(),
        url: "https://arxiv.org/abs/2401.00001v2".into(),
        pdf_url: Some("https://arxiv.org/pdf/2401.00001v2".into()),
        provider: "arxiv".into(),
        evidence_level: "abstract".into(),
    };
    let mut a: ArxivPaper = p.clone().into();
    a.title = "Complete search".into();
    a.abstract_text = "Long abstract".repeat(1000);
    a.arxiv = ArxivMetadata {
        categories: Some(vec!["cs.LG".into()]),
        published: Some("2024-01-01T00:00:00Z".into()),
        ..Default::default()
    };
    research::remember(&root, &[p.clone()]).unwrap();
    arxiv_cache::remember(&root, &[a.clone()]).unwrap();
    (dir, root, p, a)
}
pub(super) fn selection(id: &str, source: PaperCacheSource) -> PaperSelection {
    PaperSelection {
        paper_id: id.into(),
        cache_source: source,
    }
}
pub(super) fn read(root: &PathBuf, selections: &[PaperSelection]) -> Vec<ArxivPaper> {
    preview(Preview {
        root: root.clone(),
        selections: selections.to_vec(),
    })
    .unwrap()
}
#[test]
fn split_caches_keep_same_id_versions_and_approvals_independent() {
    let (_dir, root, p, a) = fixture();
    let legacy = vec![selection(&p.id, PaperCacheSource::Research)];
    let search = vec![selection(&a.id, PaperCacheSource::ArxivSearch)];
    assert_eq!(read(&root, &legacy)[0], p.clone().into());
    assert_eq!(read(&root, &search)[0], a);
    approve(Approval {
        root: root.clone(),
        selections: search.clone(),
        expected: vec![a.clone()],
        approval_id: "split-search".into(),
    })
    .unwrap();
    assert!(consume(
        Preview {
            root: root.clone(),
            selections: legacy.clone()
        },
        "split-search"
    )
    .is_err());
    assert_eq!(
        consume(
            Preview {
                root: root.clone(),
                selections: search.clone()
            },
            "split-search"
        )
        .unwrap(),
        vec![a.clone()]
    );
    assert!(consume(
        Preview {
            root: root.clone(),
            selections: search.clone()
        },
        "split-search"
    )
    .is_err());
    let mut changed = a.clone();
    changed.arxiv.categories = Some(vec!["cs.AI".into()]);
    arxiv_cache::remember(&root, &[changed]).unwrap();
    assert!(approve(Approval {
        root: root.clone(),
        selections: search,
        expected: vec![a],
        approval_id: "stale".into()
    })
    .unwrap_err()
    .contains("变化"));
    assert_eq!(read(&root, &legacy)[0].title, "Legacy");
}
#[test]
fn mixed_preview_and_frozen_grant_keep_sources_order_and_workspace() {
    let (_dir, root, p, mut a) = fixture();
    a.id = "arxiv:2401.00002v3".into();
    arxiv_cache::remember(&root, &[a.clone()]).unwrap();
    let selections = vec![
        selection(&p.id, PaperCacheSource::Research),
        selection(&a.id, PaperCacheSource::ArxivSearch),
    ];
    let papers = read(&root, &selections);
    assert_eq!(papers, vec![p.into(), a.clone()]);
    approve(Approval {
        root: root.clone(),
        selections: selections.clone(),
        expected: papers.clone(),
        approval_id: "mixed".into(),
    })
    .unwrap();
    let (_other, other, _, _) = fixture();
    assert!(consume(
        Preview {
            root: other,
            selections: selections.clone()
        },
        "mixed"
    )
    .is_err());
    let mut wrong = selections.clone();
    wrong[1].cache_source = PaperCacheSource::Research;
    assert!(consume(
        Preview {
            root: root.clone(),
            selections: wrong
        },
        "mixed"
    )
    .is_err());
    // Execution uses the approved copy even after the unapproved cache changes.
    a.title = "Later cache".into();
    arxiv_cache::remember(&root, &[a]).unwrap();
    assert_eq!(
        consume(Preview { root, selections }, "mixed").unwrap(),
        papers
    );
}
#[test]
fn expiry_capacity_and_invalid_batches_do_not_cross_caches() {
    let (_dir, root, p, a) = fixture();
    let legacy = vec![selection(&p.id, PaperCacheSource::Research)];
    let search = vec![selection(&a.id, PaperCacheSource::ArxivSearch)];
    let mut other_version = a.clone();
    other_version.id = "arxiv:2401.00001v1".into();
    arxiv_cache::remember(&root, &[other_version.clone()]).unwrap();
    assert_eq!(
        read(
            &root,
            &[selection(&other_version.id, PaperCacheSource::ArxivSearch)]
        )[0]
        .id,
        other_version.id
    );
    {
        let mut rows = arxiv_cache::cache().lock().unwrap();
        rows.iter_mut()
            .find(|r| r.root == root && r.paper.id == a.id)
            .unwrap()
            .at = Instant::now() - Duration::from_secs(3601);
    }
    assert!(preview(Preview {
        root: root.clone(),
        selections: search.clone()
    })
    .is_err());
    assert_eq!(read(&root, &legacy)[0].title, "Legacy");
    let many: Vec<_> = (0..513)
        .map(|i| {
            let mut x = a.clone();
            x.id = format!("arxiv:2402.{i:05}v1");
            x
        })
        .collect();
    arxiv_cache::remember(&root, &many).unwrap();
    assert_eq!(read(&root, &legacy)[0].title, "Legacy");
    assert!(arxiv_cache::selected(&Selection {
        root: root.clone(),
        paper_ids: vec![many[0].id.clone()]
    })
    .is_err());
    let last = selection(&many[512].id, PaperCacheSource::ArxivSearch);
    let legacy_many: Vec<Paper> = (0..513)
        .map(|i| {
            let mut x = p.clone();
            x.id = format!("arxiv:2403.{i:05}v1");
            x
        })
        .collect();
    research::remember(&root, &legacy_many).unwrap();
    assert_eq!(read(&root, &[last.clone()])[0], many[512]);
    assert!(research::selected(&Selection {
        root: root.clone(),
        paper_ids: vec![legacy_many[0].id.clone()]
    })
    .is_err());
    assert!(preview(Preview {
        root: root.clone(),
        selections: vec![last.clone(), last.clone()]
    })
    .is_err());
    assert!(preview(Preview {
        root: root.clone(),
        selections: vec![last; 11]
    })
    .is_err());
    let selections = vec![selection(&legacy_many[512].id, PaperCacheSource::Research)];
    let papers = read(&root, &selections);
    approve(Approval {
        root: root.clone(),
        selections: selections.clone(),
        expected: papers,
        approval_id: "expiry".into(),
    })
    .unwrap();
    grants()
        .lock()
        .unwrap()
        .iter_mut()
        .find(|g| g.id == "expiry")
        .unwrap()
        .at = Instant::now() - Duration::from_secs(301);
    assert!(consume(Preview { root, selections }, "expiry").is_err());
}
#[test]
fn ten_papers_are_accepted_and_missing_mixed_record_rejects_entire_preview() {
    let (_dir, root, p, a) = fixture();
    let rows: Vec<_> = (0..10)
        .map(|i| {
            let mut x = a.clone();
            x.id = format!("arxiv:2404.{i:05}v1");
            x
        })
        .collect();
    arxiv_cache::remember(&root, &rows).unwrap();
    let selections: Vec<_> = rows
        .iter()
        .map(|p| selection(&p.id, PaperCacheSource::ArxivSearch))
        .collect();
    let papers = read(&root, &selections);
    assert_eq!(papers.len(), 10);
    approve(Approval {
        root: root.clone(),
        selections: selections.clone(),
        expected: papers,
        approval_id: "ten".into(),
    })
    .unwrap();
    assert_eq!(
        consume(
            Preview {
                root: root.clone(),
                selections
            },
            "ten"
        )
        .unwrap()
        .len(),
        10
    );
    assert!(preview(Preview {
        root,
        selections: vec![
            selection(&p.id, PaperCacheSource::Research),
            selection("missing", PaperCacheSource::ArxivSearch)
        ]
    })
    .is_err());
}
