use super::{canonical, network, selected, Paper, Selection};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::Write,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Deserialize)]
pub struct Approval {
    pub root: PathBuf,
    pub paper_ids: Vec<String>,
    pub expected: Vec<Paper>,
    pub approval_id: String,
}
struct Grant {
    root: PathBuf,
    ids: Vec<String>,
    papers: Vec<Paper>,
    at: Instant,
    id: String,
}
static GRANTS: OnceLock<Mutex<Vec<Grant>>> = OnceLock::new();
fn grants() -> &'static Mutex<Vec<Grant>> {
    GRANTS.get_or_init(|| Mutex::new(Vec::new()))
}
pub fn approve(request: Approval) -> Result<(), String> {
    if request.approval_id.is_empty() || request.approval_id.len() > 100 {
        return Err("确认标识无效".into());
    }
    let selection = Selection {
        root: request.root,
        paper_ids: request.paper_ids,
    };
    let papers = selected(&selection)?;
    if papers != request.expected {
        return Err("论文信息已变化，请重新预览后确认".into());
    }
    let root = canonical(&selection.root)?;
    let mut g = grants().lock().map_err(|_| "确认状态不可用")?;
    g.retain(|v| v.at.elapsed() < Duration::from_secs(300));
    if g.iter().any(|v| v.id == request.approval_id) {
        return Err("确认已存在，请勿重复提交".into());
    }
    if g.len() >= 32 {
        return Err("待执行确认过多".into());
    }
    g.push(Grant {
        root,
        ids: selection.paper_ids,
        papers,
        at: Instant::now(),
        id: request.approval_id,
    });
    Ok(())
}
fn consume(selection: &Selection, approval_id: &str) -> Result<Vec<Paper>, String> {
    let root = canonical(&selection.root)?;
    let mut g = grants().lock().map_err(|_| "确认状态不可用")?;
    g.retain(|v| v.at.elapsed() < Duration::from_secs(300));
    let i = g
        .iter()
        .position(|v| v.root == root && v.ids == selection.paper_ids && v.id == approval_id)
        .ok_or("下载尚未经用户确认，或确认已使用／过期")?;
    Ok(g.remove(i).papers)
}

pub async fn run<R: Runtime>(
    app: &AppHandle<R>,
    selection: Selection,
    approval_id: &str,
) -> Result<Value, String> {
    let papers = consume(&selection, approval_id)?;
    // Bound peak PDF memory across conversations, not just within a batch.
    static DOWNLOAD: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    let _permit = DOWNLOAD
        .get_or_init(|| tokio::sync::Semaphore::new(1))
        .acquire()
        .await
        .map_err(|_| "下载队列不可用")?;
    let workspace =
        neuink_workspace::Workspace::open(&selection.root).map_err(|_| "资料库不可用")?;
    let mut results = vec![];
    for paper in papers {
        let result=async {
            if let Some(id)=existing(&workspace,&paper)? {return Ok(json!({"id":paper.id,"entry_id":id,"status":"already_in_library"}));}
            let url=paper.pdf_url.as_deref().ok_or("没有可下载的公开 PDF，请打开原文网页手动获取")?;
            let bytes=network::get(url,64*1024*1024).await?;
            // Network is awaited outside write lock. The synchronous commit cannot be dropped midway by cancellation.
            let persisted=persist(&workspace,&paper,&bytes);
            let _=app.emit("research-library-changed",json!({"root":selection.root}));
            let (id,reused)=persisted?;
            Ok::<Value,String>(json!({"id":paper.id,"entry_id":id,"status":if reused {"already_in_library"}else{"imported"},"parsed":false}))
        }.await;
        results.push(match result {
            Ok(v) => v,
            Err(e) => json!({"id":paper.id,"title":paper.title,"status":"failed","error":e}),
        });
    }
    Ok(
        json!({"results":results,"notice":"PDF 入库不代表已解析或已读全文。未修改标签或笔记；请使用现有解析入口后再生成有页码溯源的笔记。失败项需重新确认后重试。"}),
    )
}
fn existing(w: &neuink_workspace::Workspace, p: &Paper) -> Result<Option<String>, String> {
    let entries = w.list_entries().map_err(|_| "读取条目目录失败")?;
    let found = entries
        .iter()
        .find(|e| {
            e.fields.get("research_id") == Some(&p.id)
                || (!p.doi.is_empty()
                    && e.fields.get("doi").is_some_and(|d| {
                        d.trim_start_matches("https://doi.org/")
                            .eq_ignore_ascii_case(&p.doi)
                    }))
        })
        .map(|e| (e.id.to_string(), e.pdf.is_some()));
    match found {
        Some((id, false)) => Err(format!(
            "条目 {id} 已存在但没有 PDF；请在该条目手动补充，未重复创建"
        )),
        Some((id, true)) => Ok(Some(id)),
        None => Ok(None),
    }
}
fn persist(
    w: &neuink_workspace::Workspace,
    p: &Paper,
    bytes: &[u8],
) -> Result<(String, bool), String> {
    if !bytes.starts_with(b"%PDF-") || !bytes.windows(5).any(|s| s == b"%%EOF") {
        return Err("下载内容不是完整 PDF，未创建条目".into());
    }
    let _lock = super::super::assistant_proposal::decision_lock(w.layout().root())?;
    if let Some(id) = existing(w, p)? {
        return Ok((id, true));
    }
    let mut file = tempfile::Builder::new()
        .prefix("neuink-paper-")
        .suffix(".pdf")
        .tempfile()
        .map_err(|_| "无法创建下载临时文件")?;
    file.write_all(bytes).map_err(|_| "暂存 PDF 失败")?;
    file.flush().map_err(|_| "暂存 PDF 失败")?;
    let fields = BTreeMap::from([
        ("research_id".into(), p.id.clone()),
        ("doi".into(), p.doi.clone()),
        ("source_url".into(), p.url.clone()),
        (
            "pdf_source_url".into(),
            p.pdf_url.clone().unwrap_or_default(),
        ),
        ("authors".into(), p.authors.join(", ")),
        ("year".into(), p.year.clone()),
        ("abstract".into(), p.abstract_text.clone()),
    ]);
    let entry = w
        .create_entry_with_meta(p.title.clone(), fields, vec![])
        .map_err(|_| "创建论文条目失败，请核对条目库")?;
    w.import_pdf(&entry.id, file.path()).map_err(|_| {
        format!(
            "条目 {} 已创建，但 PDF 附加失败；请手动补充，勿重复创建",
            entry.id
        )
    })?;
    Ok((entry.id.to_string(), false))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn paper() -> Paper {
        Paper {
            id: "arxiv:2401.00001".into(),
            title: "Paper".into(),
            authors: vec![],
            year: "2024".into(),
            abstract_text: "Only an abstract".into(),
            doi: "".into(),
            url: "https://arxiv.org/abs/2401.00001".into(),
            pdf_url: Some("https://arxiv.org/pdf/2401.00001".into()),
            provider: "arxiv".into(),
            evidence_level: "abstract".into(),
        }
    }
    #[test]
    fn requires_frozen_one_time_confirmation() {
        let temp = tempfile::tempdir().unwrap();
        let w = neuink_workspace::Workspace::create(temp.path()).unwrap();
        let root = w.layout().root().canonicalize().unwrap();
        let p = paper();
        super::super::remember(&root, &[p.clone()]).unwrap();
        let s = Selection {
            root: root.clone(),
            paper_ids: vec![p.id.clone()],
        };
        assert!(consume(&s, "test-grant").is_err());
        let mut changed = p.clone();
        changed.title = "Other".into();
        assert!(approve(Approval {
            root: root.clone(),
            paper_ids: s.paper_ids.clone(),
            expected: vec![changed],
            approval_id: "test-grant".into()
        })
        .is_err());
        approve(Approval {
            root,
            paper_ids: s.paper_ids.clone(),
            expected: vec![p],
            approval_id: "test-grant".into(),
        })
        .unwrap();
        assert!(consume(&s, "another-conversation").is_err());
        assert_eq!(consume(&s, "test-grant").unwrap().len(), 1);
        assert!(consume(&s, "test-grant").is_err());
    }
    #[test]
    fn validates_pdf_and_deduplicates_without_overwriting() {
        let temp = tempfile::tempdir().unwrap();
        let w = neuink_workspace::Workspace::create(temp.path()).unwrap();
        let p = paper();
        assert!(persist(&w, &p, b"<html>login</html>").is_err());
        assert!(w.list_entries().unwrap().is_empty());
        let (id, reused) = persist(&w, &p, b"%PDF-1.4\n%%EOF").unwrap();
        assert!(!reused);
        let (again, reused) = persist(&w, &p, b"%PDF-1.4\n%%EOF").unwrap();
        assert!(reused);
        assert_eq!(id, again);
        assert_eq!(w.list_entries().unwrap().len(), 1);
    }
    #[test]
    fn incomplete_prior_import_is_reported_without_creating_a_duplicate() {
        let temp = tempfile::tempdir().unwrap();
        let w = neuink_workspace::Workspace::create(temp.path()).unwrap();
        let p = paper();
        w.create_entry_with_meta(
            "Existing",
            BTreeMap::from([("research_id".into(), p.id.clone())]),
            vec![],
        )
        .unwrap();
        assert!(persist(&w, &p, b"%PDF-1.4\n%%EOF")
            .unwrap_err()
            .contains("没有 PDF"));
        assert_eq!(w.list_entries().unwrap().len(), 1);
        assert_eq!(w.list_entries().unwrap()[0].title, "Existing");
    }
}
