use std::{
    fs,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use zip::ZipArchive;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSkillPackageArchiveRequest {
    pub root: PathBuf,
    pub archive_path: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSkillPackage {
    pub category: String,
    pub description: String,
    pub enabled: bool,
    pub files: Vec<ImportedSkillPackageFile>,
    pub id: String,
    pub installed_at: String,
    pub kind: String,
    pub metadata_only: bool,
    pub name: String,
    pub package_path: String,
    pub readme: String,
    pub resource_paths: SkillResourcePaths,
    pub script_execution: String,
    pub skill_markdown_path: String,
    pub skill_spec_version: String,
    pub source_archive_path: String,
    pub suggested_tool_ids: Vec<String>,
    pub triggers: Vec<String>,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSkillPackageFile {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillResourcePaths {
    pub assets: Vec<String>,
    pub references: Vec<String>,
    pub scripts: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadSkillPackageRequest {
    pub root: PathBuf,
    pub skill_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListSkillPackagesRequest {
    pub root: PathBuf,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SkillRegistry {
    version: u32,
    skills: Vec<ImportedSkillPackage>,
}

// Skills follow the Agent Skills shape: SKILL.md plus optional scripts/references/assets.
// Rust owns the installed registry; localStorage may cache UI settings, but it is not the source of installed packages.
pub fn import_skill_package_archive<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: ImportSkillPackageArchiveRequest,
) -> Result<ImportedSkillPackage, String> {
    let archive_path = fs::canonicalize(&request.archive_path)
        .map_err(|error| format!("无法读取技能包压缩包：{error}"))?;
    let archive_bytes = fs::read(&archive_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(Cursor::new(&archive_bytes))
        .map_err(|error| format!("技能包不是有效的 zip 压缩包，或压缩包已损坏：{error}"))?;
    let skill_file_name = find_skill_markdown(&mut archive)?;
    let readme = read_zip_text(&mut archive, &skill_file_name)?;
    validate_skill_markdown(&readme)?;

    let id = skill_package_id(&archive_path, &readme);
    let skills_root = workspace_skill_root(&request.root)?;
    let package_dir = skills_root.join(&id);
    if package_dir.exists() {
        fs::remove_dir_all(&package_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&package_dir).map_err(|error| error.to_string())?;

    let files = extract_archive(&archive_bytes, &package_dir)?;
    let skill_markdown_path = package_dir.join(Path::new(&skill_file_name));
    let resource_paths = classify_skill_resources(&files, &skill_file_name);

    let package = ImportedSkillPackage {
        category: "custom".to_string(),
        description: skill_description(&readme),
        enabled: true,
        files,
        id,
        installed_at: chrono::Utc::now().to_rfc3339(),
        kind: "installed".to_string(),
        metadata_only: false,
        name: skill_name(&archive_path, &readme),
        package_path: package_dir.to_string_lossy().to_string(),
        readme,
        resource_paths,
        script_execution: "disabled".to_string(),
        skill_markdown_path: skill_markdown_path.to_string_lossy().to_string(),
        skill_spec_version: "agent-skills".to_string(),
        source_archive_path: archive_path.to_string_lossy().to_string(),
        suggested_tool_ids: vec![],
        triggers: skill_triggers(&archive_path),
        version: "1".to_string(),
    };
    upsert_skill_registry(app, &request.root, &package)?;
    Ok(package)
}

pub fn list_skill_packages<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: ListSkillPackagesRequest,
) -> Result<Vec<ImportedSkillPackage>, String> {
    ensure_builtin_skill_packages(&app, &request.root)?;
    Ok(read_skill_registry(app, &request.root)?.skills)
}

pub fn load_skill_package<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    request: LoadSkillPackageRequest,
) -> Result<ImportedSkillPackage, String> {
    ensure_builtin_skill_packages(&app, &request.root)?;
    let registry = read_skill_registry(app, &request.root)?;
    registry
        .skills
        .into_iter()
        .find(|skill| skill.id == request.skill_id)
        .ok_or_else(|| "未找到请求的 Skill Package。".to_string())
}

fn find_skill_markdown<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
) -> Result<String, String> {
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = file.name().replace('\\', "/");
        if name.ends_with("SKILL.md") {
            return Ok(name);
        }
    }
    Err("技能包内必须包含 SKILL.md。".to_string())
}

fn read_zip_text<R: Read + std::io::Seek>(
    archive: &mut ZipArchive<R>,
    file_name: &str,
) -> Result<String, String> {
    let mut file = archive
        .by_name(file_name)
        .map_err(|error| error.to_string())?;
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| format!("无法读取 SKILL.md：{error}"))?;
    Ok(text)
}

fn validate_skill_markdown(readme: &str) -> Result<(), String> {
    if readme.trim().is_empty() {
        return Err("SKILL.md 不能为空。".to_string());
    }
    Ok(())
}

fn extract_archive(
    bytes: &[u8],
    package_dir: &Path,
) -> Result<Vec<ImportedSkillPackageFile>, String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(enclosed_name) = file.enclosed_name() else {
            continue;
        };
        let output_path = package_dir.join(&enclosed_name);
        let normalized_name = enclosed_name.to_string_lossy().replace('\\', "/");

        if file.is_dir() {
            fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut output = fs::File::create(&output_path).map_err(|error| error.to_string())?;
        std::io::copy(&mut file, &mut output).map_err(|error| error.to_string())?;
        files.push(ImportedSkillPackageFile {
            path: normalized_name,
            size_bytes: file.size(),
        });
    }
    Ok(files)
}

fn classify_skill_resources(
    files: &[ImportedSkillPackageFile],
    skill_file_name: &str,
) -> SkillResourcePaths {
    let skill_parent = Path::new(skill_file_name)
        .parent()
        .map(|path| path.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();
    let prefix = if skill_parent.is_empty() {
        String::new()
    } else {
        format!("{skill_parent}/")
    };
    let mut resources = SkillResourcePaths::default();

    for file in files {
        let path = file.path.replace('\\', "/");
        let relative = path.strip_prefix(&prefix).unwrap_or(&path);
        if relative == "SKILL.md" {
            continue;
        }
        if relative.starts_with("scripts/") {
            resources.scripts.push(path);
        } else if relative.starts_with("references/") {
            resources.references.push(path);
        } else if relative.starts_with("assets/") {
            resources.assets.push(path);
        }
    }

    resources
}

fn skill_package_id(path: &Path, readme: &str) -> String {
    slugify(&skill_name(path, readme))
}

fn skill_name(path: &Path, readme: &str) -> String {
    readme
        .lines()
        .find_map(|line| line.trim().strip_prefix("# "))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("skill-package")
                .to_string()
        })
}

fn skill_description(readme: &str) -> String {
    readme
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .next()
        .unwrap_or("标准 Skills 压缩包。")
        .to_string()
}

fn skill_triggers(path: &Path) -> Vec<String> {
    path.file_stem()
        .and_then(|name| name.to_str())
        .map(|name| {
            name.split(['-', '_', ' '])
                .map(str::trim)
                .filter(|part| part.len() >= 3)
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

fn workspace_skill_root(root: &Path) -> Result<PathBuf, String> {
    let root = fs::canonicalize(root)
        .map_err(|error| format!("无法读取工作区路径 {}: {error}", root.to_string_lossy()))?;
    let skills_root = root.join("agent-skills");
    fs::create_dir_all(&skills_root).map_err(|error| error.to_string())?;
    Ok(skills_root)
}

fn skill_registry_path(root: &Path) -> Result<PathBuf, String> {
    Ok(workspace_skill_root(root)?.join("registry.json"))
}

const BUILTIN_FEATURE_SKILL_VERSION: &str = "1";

struct BuiltinSkillPackage {
    id: &'static str,
    name: &'static str,
    category: &'static str,
    description: &'static str,
    readme: &'static str,
    output_schema: &'static str,
    suggested_tool_ids: &'static [&'static str],
    triggers: &'static [&'static str],
}

fn ensure_builtin_skill_packages<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    root: &Path,
) -> Result<(), String> {
    for builtin in builtin_skill_packages() {
        let package = write_builtin_skill_package(root, &builtin)?;
        upsert_skill_registry(app.clone(), root, &package)?;
    }
    Ok(())
}

fn write_builtin_skill_package(
    root: &Path,
    builtin: &BuiltinSkillPackage,
) -> Result<ImportedSkillPackage, String> {
    let package_dir = workspace_skill_root(root)?.join(builtin.id);
    fs::create_dir_all(package_dir.join("references")).map_err(|error| error.to_string())?;

    let skill_markdown_path = package_dir.join("SKILL.md");
    let schema_path = package_dir.join("references").join("output-schema.json");
    let files = vec![
        write_text_file(&skill_markdown_path, "SKILL.md", builtin.readme)?,
        write_text_file(
            &schema_path,
            "references/output-schema.json",
            builtin.output_schema,
        )?,
    ];

    Ok(ImportedSkillPackage {
        category: builtin.category.to_string(),
        description: builtin.description.to_string(),
        enabled: true,
        files,
        id: builtin.id.to_string(),
        installed_at: chrono::Utc::now().to_rfc3339(),
        kind: "builtin".to_string(),
        metadata_only: false,
        name: builtin.name.to_string(),
        package_path: package_dir.to_string_lossy().to_string(),
        readme: builtin.readme.to_string(),
        resource_paths: SkillResourcePaths {
            assets: vec![],
            references: vec!["references/output-schema.json".to_string()],
            scripts: vec![],
        },
        script_execution: "disabled".to_string(),
        skill_markdown_path: skill_markdown_path.to_string_lossy().to_string(),
        skill_spec_version: "agent-skills+neuink-feature-skill".to_string(),
        source_archive_path: String::new(),
        suggested_tool_ids: builtin
            .suggested_tool_ids
            .iter()
            .map(|item| item.to_string())
            .collect(),
        triggers: builtin
            .triggers
            .iter()
            .map(|item| item.to_string())
            .collect(),
        version: BUILTIN_FEATURE_SKILL_VERSION.to_string(),
    })
}

fn write_text_file(
    path: &Path,
    relative_path: &str,
    content: &str,
) -> Result<ImportedSkillPackageFile, String> {
    fs::write(path, content).map_err(|error| error.to_string())?;
    Ok(ImportedSkillPackageFile {
        path: relative_path.to_string(),
        size_bytes: fs::metadata(path).map_err(|error| error.to_string())?.len(),
    })
}

fn builtin_skill_packages() -> Vec<BuiltinSkillPackage> {
    vec![
        BuiltinSkillPackage {
            id: "translation.default",
            name: "Neuink Default Translation",
            category: "reading",
            description: "通用 PDF 翻译 Skill：保留公式、表格、引用和术语，输出结构化翻译结果。",
            readme: DEFAULT_TRANSLATION_SKILL,
            output_schema: TRANSLATION_OUTPUT_SCHEMA,
            suggested_tool_ids: &["read_entry_assistant_context", "read_segment_content"],
            triggers: &["translate", "translation", "翻译", "全文翻译"],
        },
        BuiltinSkillPackage {
            id: "tagger.default",
            name: "Neuink Default Tagger",
            category: "research",
            description: "解析完成后生成推荐标签和可审计 TagOperation 的通用 Skill。",
            readme: DEFAULT_TAGGER_SKILL,
            output_schema: TAGGER_OUTPUT_SCHEMA,
            suggested_tool_ids: &["read_entry_assistant_context", "search_segments"],
            triggers: &["tag", "tags", "标签", "推荐标签"],
        },
        BuiltinSkillPackage {
            id: "metadata.default",
            name: "Neuink Default Metadata",
            category: "research",
            description: "从通用 PDF 中抽取 key-value 属性和 FieldOperation 的 Skill。",
            readme: DEFAULT_METADATA_SKILL,
            output_schema: FIELD_OPERATION_OUTPUT_SCHEMA,
            suggested_tool_ids: &["read_entry_assistant_context"],
            triggers: &["metadata", "field", "属性", "元数据"],
        },
        BuiltinSkillPackage {
            id: "summary.default",
            name: "Neuink Default Summary",
            category: "writing",
            description: "为通用 PDF 生成摘要、关键词和笔记草稿的 Skill。",
            readme: DEFAULT_SUMMARY_SKILL,
            output_schema: SUMMARY_OUTPUT_SCHEMA,
            suggested_tool_ids: &["read_entry_assistant_context", "search_segments"],
            triggers: &["summary", "summarize", "摘要", "总结"],
        },
    ]
}

const DEFAULT_TRANSLATION_SKILL: &str = r#"# Neuink Default Translation

Use this skill when the user asks to translate a PDF, Source Segment, selected text, or parsed document content.

## Task

Translate source content into the requested target language while preserving source grounding and technical structure.

## Inputs

- Entry title and optional item type.
- Source language and target language.
- Parsed Source Segments with `segment_uid`, page, type, and Markdown content.
- Optional user glossary or previously confirmed terminology.

## Rules

1. Do not assume the document is an academic paper. First infer whether it is a paper, report, manual, legal document, standard, contract, slide deck, or generic PDF.
2. Preserve formulas, citations, numbers, code, Markdown tables, image placeholders, and technical symbols.
3. Keep inline math wrapped in `$...$`; never add spaces around LaTeX commands, `_`, `^`, braces, or formula delimiters.
4. Translate prose naturally, but keep proper nouns, identifiers, model names, dataset names, and standards stable unless a known translation exists.
5. Return strict JSON only. Do not include Markdown fences.

## Output

Return the schema in `references/output-schema.json`.
"#;

const DEFAULT_TAGGER_SKILL: &str = r#"# Neuink Default Tagger

Use this skill after PDF parsing succeeds, when the PDF header shows `推荐标签`, or when the user asks the assistant to organize tags.

## Task

Generate auditable `TagOperation` proposals from document content and the current local tag tree.

## Inputs

- `document`: title, abstract, headings, representative segments, item type, fields.
- `existing_tags`: tag id, label, path, level, aliases.
- `user_preferences`: domain hint, max depth, naming style, conservative mode.

## Rules

1. Do not assume every PDF is a computer science paper. Infer the domain first.
2. Prefer existing tags. Propose a new tag only when the current tree cannot express the topic.
3. Default to at most three levels: broad domain / topic or task / subtopic, method, dataset, or scenario.
4. For a new tag, include parent tag, target level, reason, confidence, and evidence.
5. Existing-tag attachment is usually low risk. Creating a tag is medium risk. Moving, merging, and renaming tags are high risk and need confirmation.
6. Output strict JSON only. The application service applies operations; this skill never writes files directly.

## Output

Return the schema in `references/output-schema.json`.
"#;

const DEFAULT_METADATA_SKILL: &str = r#"# Neuink Default Metadata

Use this skill to suggest generic key-value fields for an Entry.

## Task

Extract `FieldOperation` proposals from a PDF without forcing all documents into academic-paper metadata.

## Rules

1. Use generic fields first: `title`, `item_type`, `language`, `date`, `abstract`, `source`, `url`.
2. Suggest identifiers when evidence exists: `doi`, `isbn`, `arxiv_id`, `pmid`, `standard_number`.
3. Use responsibility fields flexibly: `author`, `editor`, `translator`, `organization`, `authority`.
4. For conferences, distinguish `conference_name`, `event_year`, `event_place`, `proceedings_title`, and `publisher_place`.
5. Put uncertain or domain-specific fields under `extra.*`.
6. Do not overwrite existing user fields without returning a medium or high risk operation.

## Output

Return the schema in `references/output-schema.json`.
"#;

const DEFAULT_SUMMARY_SKILL: &str = r#"# Neuink Default Summary

Use this skill to summarize a generic PDF, generate keywords, or draft a note outline.

## Task

Produce a concise document summary grounded in parsed Source Segments.

## Rules

1. Do not assume document type. Mention inferred type only when evidence supports it.
2. Separate what the document says from possible user interpretation.
3. Prefer cited evidence from headings, abstract-like sections, conclusion-like sections, and representative segments.
4. Keep keywords reusable as tags or fields, but do not create tags directly.
5. Return strict JSON only.

## Output

Return the schema in `references/output-schema.json`.
"#;

const TRANSLATION_OUTPUT_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["segments"],
  "properties": {
    "summary": { "type": "string" },
    "terminology": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["source", "target"],
        "properties": {
          "source": { "type": "string" },
          "target": { "type": "string" },
          "note": { "type": ["string", "null"] }
        }
      }
    },
    "segments": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["segment_uid", "translated_text"],
        "properties": {
          "segment_uid": { "type": "string" },
          "translated_text": { "type": "string" }
        }
      }
    }
  }
}
"#;

const TAGGER_OUTPUT_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["domain", "operations"],
  "properties": {
    "domain": { "type": "string" },
    "summary": { "type": "string" },
    "operations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["operation", "label", "confidence", "risk", "reason", "evidence"],
        "properties": {
          "operation": {
            "enum": ["attach_entry_tag", "create_tag", "move_tag", "merge_tags", "rename_tag", "detach_entry_tag"]
          },
          "target": { "type": ["string", "null"] },
          "label": { "type": "string" },
          "parent_tag_id": { "type": ["string", "null"] },
          "path": { "type": "array", "items": { "type": "string" } },
          "level": { "type": "integer", "minimum": 1 },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "risk": { "enum": ["low", "medium", "high"] },
          "reason": { "type": "string" },
          "evidence": { "type": "array", "items": { "type": "string" } }
        }
      }
    },
    "questions": { "type": "array", "items": { "type": "string" } }
  }
}
"#;

const FIELD_OPERATION_OUTPUT_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["operations"],
  "properties": {
    "operations": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["operation", "key", "confidence", "risk", "reason", "evidence"],
        "properties": {
          "operation": { "enum": ["set_field", "unset_field", "rename_field", "set_item_type", "add_field_alias"] },
          "key": { "type": "string" },
          "value": {},
          "next_key": { "type": ["string", "null"] },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "risk": { "enum": ["low", "medium", "high"] },
          "reason": { "type": "string" },
          "evidence": { "type": "array", "items": { "type": "string" } }
        }
      }
    }
  }
}
"#;

const SUMMARY_OUTPUT_SCHEMA: &str = r#"{
  "type": "object",
  "required": ["summary", "keywords"],
  "properties": {
    "document_type": { "type": "string" },
    "summary": { "type": "string" },
    "key_points": { "type": "array", "items": { "type": "string" } },
    "keywords": { "type": "array", "items": { "type": "string" } },
    "evidence": { "type": "array", "items": { "type": "string" } }
  }
}
"#;

fn read_skill_registry<R: tauri::Runtime>(
    _app: tauri::AppHandle<R>,
    root: &Path,
) -> Result<SkillRegistry, String> {
    let path = skill_registry_path(root)?;
    if !path.exists() {
        return Ok(SkillRegistry {
            version: 1,
            skills: vec![],
        });
    }
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| format!("无法读取 Skill Registry：{error}"))
}

fn upsert_skill_registry<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    root: &Path,
    package: &ImportedSkillPackage,
) -> Result<(), String> {
    let path = skill_registry_path(root)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut registry = read_skill_registry(app, root)?;
    registry.version = 1;
    registry.skills.retain(|skill| skill.id != package.id);
    registry.skills.push(package.clone());
    registry
        .skills
        .sort_by(|left, right| left.name.cmp(&right.name));
    let bytes = serde_json::to_vec_pretty(&registry).map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn slugify(value: &str) -> String {
    let slug = value
        .to_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "skill-package".to_string()
    } else {
        slug
    }
}
