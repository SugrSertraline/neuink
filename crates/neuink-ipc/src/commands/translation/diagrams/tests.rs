use super::*;

fn labels(prepared: &DiagramText, values: &[&str]) -> Vec<TranslatedLabel> {
    assert_eq!(prepared.input_labels().len(), values.len());
    values
        .iter()
        .enumerate()
        .map(|(label_id, value)| TranslatedLabel {
            label_id,
            translated_text: value.to_string(),
        })
        .collect()
}

#[test]
fn translates_labels_without_exposing_structure_to_model() {
    let source = "Caption\n```mermaid\ngraph TD\nA[Input] -->|Yes| B{Ready?}\nB --> C[\"Result\"]\nstyle A fill:#fff\n```\nEnd.";
    let prepared = DiagramText::prepare(source);
    assert_eq!(prepared.text, "Caption\n⟪NEUINK_DIAGRAM_0⟫End.");
    let translated = labels(&prepared, &["输入", "是", "就绪？", "结果"]);
    assert_eq!(prepared.restore("图注\n⟪NEUINK_DIAGRAM_0⟫结束。", &translated).unwrap(),
        "图注\n```mermaid\ngraph TD\nA[输入] -->|是| B{就绪？}\nB --> C[\"结果\"]\nstyle A fill:#fff\n```\n结束。");
}

#[test]
fn preserves_nested_shapes_unicode_math_and_multiple_diagrams() {
    let source = "```mermaid\nflowchart LR\nA([Input]) --> B[[Output $x_i$]]\n```\n~~~mermaid\ngraph TD\nC[数据] --> D[(Store)]\n~~~";
    let prepared = DiagramText::prepare(source);
    let translated = labels(&prepared, &["输入", "输出 ⟪NEUINK_MATH_0⟫", "数据", "存储"]);
    let restored = prepared.restore(&prepared.text, &translated).unwrap();
    assert!(restored.contains("A([输入]) --> B[[输出 $x_i$]]"));
    assert!(restored.contains("C[数据] --> D[(存储)]"));
}

#[test]
fn never_translates_styles_configuration_or_identifiers() {
    let source = "```mermaid\nflowchart LR\n%%{init: {\"theme\": \"forest\"}}%%\nA --> B\nclassDef x font-family:\"Arial\"\nC@{ shape: \"circle\", label: \"Keep\" }\n```";
    let prepared = DiagramText::prepare(source);
    assert!(prepared.input_labels().is_empty());
    assert_eq!(prepared.restore(&prepared.text, &[]).unwrap(), source);
}

#[test]
fn yaml_settings_are_preserved_for_fenced_and_bare_mermaid() {
    let diagram = "---\nconfig:\n  theme: \"dark\"\n  themeVariables:\n    fontFamily: \"Arial\"\n---\nflowchart TD\nA[\"Input\"] --> B[\"Output\"]";
    for source in [diagram.to_string(), format!("```mermaid\n{diagram}\n```")] {
        let prepared = DiagramText::prepare(&source);
        assert!(prepared.contains_mermaid());
        assert_eq!(prepared.input_labels().len(), 2);
        let translated = labels(&prepared, &["输入", "输出"]);
        let restored = prepared.restore(&prepared.text, &translated).unwrap();
        assert_eq!(
            restored,
            source.replace("Input", "输入").replace("Output", "输出")
        );
        assert!(restored.contains("theme: \"dark\"") && restored.contains("fontFamily: \"Arial\""));
    }
}

#[test]
fn unfinished_yaml_configuration_is_never_exposed_as_labels() {
    let source = "```mermaid\n---\nconfig:\n  theme: \"dark\"\n```";
    let prepared = DiagramText::prepare(source);
    assert!(prepared.input_labels().is_empty());
    assert_eq!(prepared.restore(&prepared.text, &[]).unwrap(), source);
}

#[test]
fn validates_labels_and_tokens_and_escapes_reserved_characters() {
    let prepared = DiagramText::prepare("graph TD\nA[Input] --> B[Output]");
    assert!(prepared.restore(&prepared.text, &[]).is_err());
    let translated = labels(&prepared, &["输入[数据]", "输出\"结果\""]);
    assert!(prepared.restore("missing token", &translated).is_err());
    assert!(prepared
        .restore("⟪NEUINK_DIAGRAM_0⟫⟪NEUINK_DIAGRAM_0⟫", &translated)
        .is_err());
    assert_eq!(
        prepared.restore(&prepared.text, &translated).unwrap(),
        "graph TD\nA[输入#91;数据#93;] --> B[输出#34;结果#34;]"
    );
    let duplicate = vec![
        TranslatedLabel {
            label_id: 0,
            translated_text: "a".into(),
        },
        TranslatedLabel {
            label_id: 0,
            translated_text: "b".into(),
        },
    ];
    assert!(prepared.restore(&prepared.text, &duplicate).is_err());
}

#[test]
fn leaves_regular_images_and_non_mermaid_code_untouched() {
    for source in [
        "![Architecture](images/a.png)",
        "```python\nprint(\"Hello\")\n```",
        "Text $x_i$.",
    ] {
        let prepared = DiagramText::prepare(source);
        assert!(prepared.input_labels().is_empty());
        assert_eq!(prepared.restore(source, &[]).unwrap(), source);
    }
}

#[test]
fn preserves_html_layout_and_latex_inside_labels() {
    let source = "```mermaid\ngraph TD\nA[\"Input<br/><b>Output</b> $$\\frac{x}{y}$$\"] --> B[Result (x)]\n```";
    let prepared = DiagramText::prepare(source);
    let translated = labels(
        &prepared,
        &["输入", "输出", " ⟪NEUINK_MATH_0⟫", "结果（x）"],
    );
    let restored = prepared.restore(&prepared.text, &translated).unwrap();
    assert!(restored.contains("Input") == false);
    assert!(restored.contains("输入<br/><b>输出</b> $$\\frac{x}{y}$$"));
    assert!(restored.contains("B[结果（x）]"));
}
