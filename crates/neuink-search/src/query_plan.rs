use neuink_domain::CanonicalSectionRole;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum QueryModality {
    #[default]
    Any,
    Table,
    Figure,
    Math,
    Code,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct QueryPlan {
    pub modality: QueryModality,
    pub section_role: Option<CanonicalSectionRole>,
    pub section_filter: Option<String>,
}

/// Cheap, deterministic intent hints used before lexical/vector retrieval.
/// Unknown language remains `Any`, preserving flat-search recall.
pub fn infer_query_plan(query: &str) -> QueryPlan {
    let normalized = query.to_ascii_lowercase();
    let modality = if contains_any(&normalized, &["table", "tab.", "表", "表格"]) {
        QueryModality::Table
    } else if contains_any(&normalized, &["figure", "fig.", "图", "图片", "可视化"]) {
        QueryModality::Figure
    } else if contains_any(&normalized, &["equation", "formula", "式", "公式"]) {
        QueryModality::Math
    } else if contains_any(&normalized, &["code", "implementation", "代码", "伪代码"]) {
        QueryModality::Code
    } else {
        QueryModality::Any
    };
    let section_role = if contains_any(&normalized, &["method", "approach", "方法", "模型结构"])
    {
        Some(CanonicalSectionRole::Methods)
    } else if contains_any(&normalized, &["experiment", "evaluation", "实验", "评测"]) {
        Some(CanonicalSectionRole::Experiments)
    } else if contains_any(&normalized, &["result", "finding", "结果", "发现"]) {
        Some(CanonicalSectionRole::Results)
    } else if contains_any(
        &normalized,
        &["related work", "literature", "相关工作", "研究现状"],
    ) {
        Some(CanonicalSectionRole::RelatedWork)
    } else if contains_any(&normalized, &["conclusion", "总结", "结论"]) {
        Some(CanonicalSectionRole::Conclusion)
    } else {
        None
    };
    QueryPlan {
        modality,
        section_role,
        section_filter: None,
    }
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| haystack.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_section_and_modality_hints() {
        let plan = infer_query_plan("What table reports the experiment results?");
        assert_eq!(plan.modality, QueryModality::Table);
        assert_eq!(plan.section_role, Some(CanonicalSectionRole::Experiments));
    }

    #[test]
    fn unknown_queries_keep_flat_recall() {
        assert_eq!(infer_query_plan("authors"), QueryPlan::default());
    }
}
