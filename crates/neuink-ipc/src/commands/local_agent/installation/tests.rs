use super::*;
use serde_json::json;

fn fixture(provider: Provider, bin: serde_json::Value) -> (tempfile::TempDir, PathBuf, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let prefix = temp.path().join("工具目录 with spaces & symbols");
    let root = prefix.join("node_modules").join(package(provider).0);
    fs::create_dir_all(&root).unwrap();
    fs::write(
        root.join("package.json"),
        json!({"name":package(provider).0,"bin":bin}).to_string(),
    )
    .unwrap();
    (temp, prefix, root)
}

pub(crate) fn test_node() -> PathBuf {
    let mut directories = search_directories(Provider::Claude);
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        directories.push(PathBuf::from(program_files).join("nodejs"));
    }
    directories
        .into_iter()
        .map(|directory| directory.join(if cfg!(windows) { "node.exe" } else { "node" }))
        .find(|path| path.is_file())
        .expect("Node.js is required for the desktop workspace tests")
}

#[tokio::test]
async fn npm_script_without_native_payload_is_detected_and_preserves_argument_boundaries() {
    let (_temp, prefix, root) = fixture(Provider::Claude, json!({"claude":"cli.js"}));
    fs::write(
        root.join("cli.js"),
        r#"
if (process.argv[2] === '--version') console.log('2.1.228 (Claude Code)');
else console.log(JSON.stringify(process.argv.slice(2)));
"#,
    )
    .unwrap();
    fs::write(prefix.join("claude.cmd"), "DO NOT EXECUTE THIS SHIM").unwrap();
    let node = test_node();
    let candidates = discover_in(
        Provider::Claude,
        &[prefix.clone()],
        &[node.parent().unwrap().into()],
    );
    assert!(!prefix
        .join("node_modules/@anthropic-ai/claude-code/bin/claude.exe")
        .exists());
    let command = crate::commands::local_agent::probe_candidates(Provider::Claude, candidates)
        .await
        .unwrap();
    assert!(matches!(&command, AgentExecutable::Node { .. }));
    let arguments = [
        "-p",
        "含空格的输入 & echo should-not-run",
        "--resume",
        "session-123",
    ];
    let output = command.command().args(arguments).output().await.unwrap();
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<Vec<String>>(&output.stdout).unwrap(),
        arguments
    );
}

#[test]
fn npm_metadata_resolves_each_official_provider_and_rejects_foreign_package_names() {
    for provider in [Provider::Claude, Provider::Codex, Provider::Opencode] {
        let (_temp, _prefix, root) =
            fixture(provider, json!({package(provider).1: "bin/entry.cjs"}));
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin/entry.cjs"), "").unwrap();
        assert!(package_entry(&root, package(provider).0, package(provider).1).is_some());
        assert!(package_entry(&root, "unexpected-package", package(provider).1).is_none());
    }
}

#[test]
fn missing_node_and_incomplete_installs_have_actionable_distinct_errors() {
    let (_temp, prefix, root) = fixture(Provider::Claude, json!("cli.js"));
    fs::write(root.join("cli.js"), "").unwrap();
    let candidates = discover_in(Provider::Claude, &[prefix.clone()], &[]);
    assert!(candidates.executables.is_empty());
    assert!(candidates
        .missing_message(Provider::Claude)
        .contains("找不到 Node.js"));
    fs::remove_file(root.join("cli.js")).unwrap();
    assert!(discover_in(Provider::Claude, &[prefix], &[])
        .missing_message(Provider::Claude)
        .contains("入口缺失"));
    assert!(discover_in(Provider::Claude, &[], &[])
        .missing_message(Provider::Claude)
        .starts_with("未检测到"));
}

#[test]
fn metadata_cannot_escape_package_or_select_shell_commands() {
    let (_temp, prefix, root) = fixture(Provider::Claude, json!("cli.js"));
    fs::write(root.join("cli.js"), "").unwrap();
    for relative in [
        "../outside.js",
        "/outside.js",
        "C:/outside.js",
        "..\\outside.js",
        "cli.js --eval bad",
        "",
    ] {
        fs::write(
            root.join("package.json"),
            json!({"name":package(Provider::Claude).0,"bin":relative}).to_string(),
        )
        .unwrap();
        assert!(package_entry(&root, package(Provider::Claude).0, "claude").is_none());
    }
    for shim in ["entry.cmd", "entry.ps1", "entry.bat"] {
        fs::write(root.join(shim), "not-a-program").unwrap();
        fs::write(
            root.join("package.json"),
            json!({"name":package(Provider::Claude).0,"bin":shim}).to_string(),
        )
        .unwrap();
        assert!(discover_in(Provider::Claude, &[prefix.clone()], &[])
            .executables
            .is_empty());
    }
    fs::write(root.join("package.json"), vec![b' '; 64 * 1024 + 1]).unwrap();
    assert!(package_entry(&root, package(Provider::Claude).0, "claude").is_none());
}

#[cfg(windows)]
#[test]
fn native_payloads_take_priority_and_platform_dependency_is_detected_without_bin_link() {
    let (_temp, prefix, root) = fixture(Provider::Claude, json!("cli.js"));
    fs::write(root.join("cli.js"), "").unwrap();
    let native = native_candidates(&prefix, Provider::Claude).pop().unwrap();
    fs::create_dir_all(native.parent().unwrap()).unwrap();
    fs::write(&native, "fixture").unwrap();
    let node = test_node();
    let candidates = discover_in(
        Provider::Claude,
        &[prefix],
        &[node.parent().unwrap().into()],
    );
    assert_eq!(
        candidates.executables.first(),
        Some(&AgentExecutable::Native(native))
    );
    assert!(matches!(
        candidates.executables.last(),
        Some(AgentExecutable::Node { .. })
    ));
}

#[tokio::test]
async fn invalid_version_and_nonzero_exit_never_pass_detection() {
    let (_temp, prefix, root) = fixture(Provider::Claude, json!("cli.js"));
    let node = test_node();
    for (script, message) in [
        ("console.log('node v22.0.0')", "版本输出无法识别"),
        (
            "console.log('2.1.228 (Claude Code)'); process.exitCode = 1",
            "版本检查异常退出",
        ),
    ] {
        fs::write(root.join("cli.js"), script).unwrap();
        let candidates = discover_in(
            Provider::Claude,
            &[prefix.clone()],
            &[node.parent().unwrap().into()],
        );
        let error = crate::commands::local_agent::probe_candidates(Provider::Claude, candidates)
            .await
            .unwrap_err();
        assert!(error.contains(message), "{error}");
        assert!(!error.contains(&root.to_string_lossy().to_string()));
    }
}

#[tokio::test]
async fn stalled_version_probe_does_not_hide_a_working_installation() {
    let (_temp, _prefix, root) = fixture(Provider::Claude, json!("cli.js"));
    let stalled = root.join("stalled.cjs");
    let working = root.join("working.cjs");
    fs::write(&stalled, "setInterval(() => {}, 1000)").unwrap();
    fs::write(&working, "console.log('2.1.228 (Claude Code)')").unwrap();
    let program = test_node();
    let good = AgentExecutable::Node {
        program: program.clone(),
        script: working,
    };
    let candidates = Candidates {
        executables: vec![
            AgentExecutable::Node {
                program,
                script: stalled,
            },
            good.clone(),
        ],
        ..Candidates::default()
    };
    assert_eq!(
        crate::commands::local_agent::probe_candidates(Provider::Claude, candidates)
            .await
            .unwrap(),
        good
    );
}
