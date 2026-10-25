//! Resolve installed CLI payloads without evaluating shell shims or project commands.
use super::Provider;
use std::{
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};
use tokio::process::Command;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum AgentExecutable {
    Native(PathBuf),
    Node { program: PathBuf, script: PathBuf },
}

impl AgentExecutable {
    pub(super) fn command(&self) -> Command {
        match self {
            Self::Native(path) => Command::new(path),
            Self::Node { program, script } => {
                let mut command = Command::new(program);
                command.arg(script);
                command
            }
        }
    }
}

impl From<PathBuf> for AgentExecutable {
    fn from(path: PathBuf) -> Self {
        Self::Native(path)
    }
}

#[derive(Default)]
pub(super) struct Candidates {
    pub executables: Vec<AgentExecutable>,
    missing_node: bool,
    npm_found: bool,
    shim_found: bool,
}

impl Candidates {
    pub(super) fn missing_message(&self, provider: Provider) -> String {
        let name = provider.name();
        if self.missing_node {
            format!("已找到 {name} 的 npm 脚本入口，但找不到 Node.js 程序。请安装 Node.js 或使用该工具的原生安装版，然后重新启动 Neuink。")
        } else if self.npm_found || self.shim_found {
            format!("已找到 {name} 的 npm 安装或启动脚本，但程序入口缺失或不受支持。请检查 npm 安装是否完整，或使用该工具的原生安装版。")
        } else {
            format!("未检测到 {name}，请安装后重新检测。")
        }
    }
}

fn search_directories(provider: Provider) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        directories.push(PathBuf::from(&home).join(".local/bin"));
        if provider == Provider::Opencode {
            directories.push(PathBuf::from(home).join(".opencode/bin"));
        }
    }
    if let Some(app_data) = std::env::var_os("APPDATA") {
        directories.push(PathBuf::from(app_data).join("npm"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path).filter(|path| path.is_absolute()));
    }
    let mut unique = Vec::new();
    for directory in directories {
        if directory.is_absolute() && !unique.contains(&directory) {
            unique.push(directory);
        }
    }
    unique
}

pub(super) fn discover(provider: Provider) -> Candidates {
    let directories = search_directories(provider);
    let mut node_directories = directories.clone();
    if cfg!(windows) {
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(directory) = std::env::var_os(variable) {
                let directory = PathBuf::from(directory).join("nodejs");
                if directory.is_absolute() {
                    node_directories.push(directory);
                }
            }
        }
    }
    discover_in(provider, &directories, &node_directories)
}

fn package(provider: Provider) -> (&'static str, &'static str) {
    match provider {
        Provider::Claude => ("@anthropic-ai/claude-code", "claude"),
        Provider::Codex => ("@openai/codex", "codex"),
        Provider::Opencode => ("opencode-ai", "opencode"),
    }
}

fn discover_in(
    provider: Provider,
    directories: &[PathBuf],
    node_directories: &[PathBuf],
) -> Candidates {
    let mut result = Candidates::default();
    // Prefer native payloads even when another installation also exposes a JS entry.
    for directory in directories {
        for path in native_candidates(directory, provider) {
            let command = AgentExecutable::Native(path.clone());
            if path.is_file() && !result.executables.contains(&command) {
                result.executables.push(command);
            }
        }
    }
    let (package_name, bin_name) = package(provider);
    for directory in directories {
        result.shim_found |= ["cmd", "ps1"]
            .iter()
            .any(|extension| directory.join(format!("{bin_name}.{extension}")).is_file());
        let root = directory.join("node_modules").join(package_name);
        if !root.join("package.json").is_file() {
            continue;
        }
        result.npm_found = true;
        let Some(entry) = package_entry(&root, package_name, bin_name) else {
            continue;
        };
        let extension = entry
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if extension.eq_ignore_ascii_case("exe") || (!cfg!(windows) && extension.is_empty()) {
            let command = AgentExecutable::Native(entry);
            if !result.executables.contains(&command) {
                result.executables.push(command);
            }
        } else if ["js", "cjs", "mjs"].contains(&extension) {
            let node_name = if cfg!(windows) { "node.exe" } else { "node" };
            let mut found = false;
            for node_dir in std::iter::once(directory).chain(node_directories.iter()) {
                let program = node_dir.join(node_name);
                if !program.is_file() {
                    continue;
                }
                found = true;
                let command = AgentExecutable::Node {
                    program,
                    script: entry.clone(),
                };
                if !result.executables.contains(&command) {
                    result.executables.push(command);
                }
            }
            result.missing_node |= !found;
        }
    }
    result
}

fn package_entry(root: &Path, package_name: &str, bin_name: &str) -> Option<PathBuf> {
    let file = fs::File::open(root.join("package.json")).ok()?;
    let mut bytes = Vec::new();
    file.take(64 * 1024 + 1).read_to_end(&mut bytes).ok()?;
    if bytes.len() > 64 * 1024 {
        return None;
    }
    let metadata: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    if metadata["name"].as_str()? != package_name {
        return None;
    }
    let bin = &metadata["bin"];
    let relative = bin
        .as_str()
        .or_else(|| bin.get(bin_name).and_then(|value| value.as_str()))?;
    // Package metadata is data, not a shell command or permission to execute elsewhere.
    if relative.is_empty() || relative.contains(['\\', ':', '\0']) {
        return None;
    }
    let relative = Path::new(relative);
    if relative
        .components()
        .any(|part| !matches!(part, Component::Normal(_) | Component::CurDir))
    {
        return None;
    }
    let entry = root.join(relative);
    let canonical_root = fs::canonicalize(root).ok()?;
    let canonical_entry = fs::canonicalize(&entry).ok()?;
    // Validate the real destination, but retain the normal absolute spelling for Node:
    // Windows verbatim paths (\\?\) from canonicalize break Node's JS entry resolution.
    (canonical_entry.starts_with(canonical_root) && canonical_entry.is_file()).then_some(entry)
}

pub(super) fn native_candidates(directory: &Path, provider: Provider) -> Vec<PathBuf> {
    if cfg!(windows) {
        let platform = if cfg!(target_arch = "aarch64") {
            "arm64"
        } else {
            "x64"
        };
        let triple = if cfg!(target_arch = "aarch64") {
            "aarch64-pc-windows-msvc"
        } else {
            "x86_64-pc-windows-msvc"
        };
        match provider {
            Provider::Claude => vec![
                directory.join("claude.exe"),
                directory.join("node_modules/@anthropic-ai/claude-code/bin/claude.exe"),
                directory.join(format!("node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-win32-{platform}/claude.exe")),
                directory.join(format!("node_modules/@anthropic-ai/claude-code-win32-{platform}/claude.exe")),
            ],
            Provider::Codex => vec![
                directory.join("codex.exe"),
                directory.join(format!("node_modules/@openai/codex/node_modules/@openai/codex-win32-{platform}/vendor/{triple}/bin/codex.exe")),
                directory.join(format!("node_modules/@openai/codex-win32-{platform}/vendor/{triple}/bin/codex.exe")),
                directory.join(format!("node_modules/@openai/codex/vendor/{triple}/codex/codex.exe")),
            ],
            Provider::Opencode => vec![
                directory.join("opencode.exe"),
                directory.join(format!("node_modules/opencode-ai/node_modules/opencode-windows-{platform}/bin/opencode.exe")),
                directory.join(format!("node_modules/opencode-windows-{platform}/bin/opencode.exe")),
            ],
        }
    } else {
        vec![directory.join(package(provider).1)]
    }
}

#[cfg(test)]
pub(super) mod tests;
