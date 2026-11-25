//! Use the same searchable terms for retrieval and ranking; keep user labels unchanged.
use std::collections::BTreeSet;

pub(super) fn terms(label: &str) -> Vec<String> {
    let mut terms: Vec<_> = label
        .split(|c: char| !(c.is_ascii_alphanumeric() || c.is_ascii_whitespace() || c == '-'))
        .map(|part| {
            part.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
        })
        .filter(|part| {
            (part.len() >= 3 || part == "ai") && part.bytes().any(|c| c.is_ascii_alphabetic())
        })
        .collect();
    // Prefer the author's explicit English alias. Common Chinese research labels work without
    // a model or user-managed recommendation vocabulary; never invent translations for unknowns.
    if terms.is_empty() {
        let label = label.trim();
        for (aliases, english) in [
            (&["扩散模型"][..], "diffusion"),
            (
                &["交通流量预测", "交通流预测", "交通预测"][..],
                "traffic forecasting",
            ),
            (&["时间序列预测"][..], "time series forecasting"),
            (&["时间序列"][..], "time series"),
            (&["时空图神经网络"][..], "spatio-temporal graph neural"),
            (&["图神经网络"][..], "graph neural"),
            (&["图结构学习"][..], "graph structure learning"),
            (&["对比学习"][..], "contrastive learning"),
            (&["自监督学习"][..], "self-supervised"),
            (&["强化学习"][..], "reinforcement learning"),
            (&["机器学习"][..], "machine learning"),
            (&["深度学习"][..], "deep learning"),
            (
                &["大语言模型", "语言大模型", "大模型"][..],
                "large language model",
            ),
            (&["检索增强生成"][..], "retrieval augmented generation"),
            (&["自然语言处理"][..], "natural language processing"),
            (&["计算机视觉"][..], "computer vision"),
            (&["多模态"][..], "multimodal"),
            (&["知识图谱"][..], "knowledge graph"),
            (&["推荐系统"][..], "recommender"),
            (&["联邦学习"][..], "federated learning"),
            (&["因果推断"][..], "causal inference"),
        ] {
            if aliases.iter().any(|alias| label.contains(alias)) {
                terms.push(english.into());
                break;
            }
        }
    }
    terms
}

pub(super) fn search_query(topics: &[String]) -> String {
    let mut seen = BTreeSet::new();
    topics
        .iter()
        .flat_map(|topic| terms(topic))
        .filter(|term| seen.insert(term.clone()))
        .take(10)
        .map(|term| format!("all:\"{term}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}

pub(super) fn matches(text: &str, label: &str) -> bool {
    let text = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let label = label.trim().to_lowercase();
    !label.is_empty()
        && ((!label.is_ascii() && text.contains(&label))
            || terms(&label).iter().any(|term| {
                // An acronym such as PeMS must not match the middle of an unrelated word.
                text.match_indices(term).any(|(at, found)| {
                    let before = text[..at].chars().next_back();
                    let after = text[at + found.len()..].chars().next();
                    !before.is_some_and(|c| c.is_ascii_alphanumeric())
                        && !after.is_some_and(|c| c.is_ascii_alphanumeric())
                })
            }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bilingual_tags_use_english_aliases_without_chinese_query_phrases() {
        let topics = vec![
            "对比学习（contrastive learning）".into(),
            "pems交通数据集".into(),
            "交通流量预测".into(),
            "时空图神经网络（STGNN）".into(),
            "contrastive learning".into(),
        ];
        assert_eq!(
            search_query(&topics),
            "all:\"contrastive learning\" OR all:\"pems\" OR all:\"traffic forecasting\" OR all:\"stgnn\""
        );
        assert!(matches("Contrastive\n learning for traffic", &topics[0]));
        assert!(matches("Evaluated on PeMS", &topics[1]));
        assert!(!matches("Other datasets", &topics[1]));
        assert!(!matches("Superstgnnetwork", &topics[3]));
        assert!(matches("Traffic forecasting on road networks", &topics[2]));
        assert_eq!(terms("扩散模型"), vec!["diffusion"]);
        assert!(terms("尚未识别的标签").is_empty());
    }
}
