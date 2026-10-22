use super::{error, request, Provider};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path};

const MAX_CONSECUTIVE_CODEX_RETRIES: u8 = 6;

pub(super) struct Protocol<'a> {
    pub(super) provider: Provider,
    pub(super) cwd: &'a Path,
    pub(super) session: String,
    pub(super) resume: bool,
    pub(super) prompt: &'a str,
    pub(super) url: &'a str,
    pub(super) token: &'a str,
    pub(super) ready: bool,
    pub(super) active: bool,
    pub(super) answer: String,
    pub(super) message: String,
    pub(super) file_changes: HashMap<String, Value>,
    pub(super) upstream_failures: u8,
}
impl Protocol<'_> {
    pub(super) fn initialize(&self) -> Value {
        request(
            self.provider,
            0,
            "initialize",
            if self.provider == Provider::Codex {
                json!({"clientInfo":{"name":"neuink","title":"NeuInk","version":env!("CARGO_PKG_VERSION")}})
            } else {
                json!({"protocolVersion":1,"clientInfo":{"name":"neuink","version":env!("CARGO_PKG_VERSION")},
            "clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false}})
            },
        )
    }
    pub(super) fn setup(&self, init: &Value) -> Result<Value, String> {
        if self.provider == Provider::Codex {
            let mut params = json!({"cwd":self.cwd,"approvalPolicy":"untrusted","approvalsReviewer":"user","sandbox":"read-only",
                "developerInstructions":include_str!("../prompt.md"),
                "config":{"mcp_servers":{"neuink":{"url":self.url,"http_headers":{"Authorization":format!("Bearer {}",self.token)},"required":true}}}});
            if self.resume {
                params["threadId"] = json!(self.session);
            }
            Ok(request(
                self.provider,
                1,
                if self.resume {
                    "thread/resume"
                } else {
                    "thread/start"
                },
                params,
            ))
        } else {
            if init["agentCapabilities"]["mcpCapabilities"]["http"] != true {
                return Err("OpenCode 当前版本不支持所需的 HTTP MCP，请更新后重试。".into());
            }
            if self.resume && init["agentCapabilities"]["loadSession"] != true {
                return Err("OpenCode 当前版本不支持恢复对话，请更新或新建对话。".into());
            }
            let mut params = json!({"cwd":self.cwd,"mcpServers":[{"type":"http","name":"neuink","url":self.url,
                "headers":[{"name":"Authorization","value":format!("Bearer {}",self.token)}]}]});
            if self.resume {
                params["sessionId"] = json!(self.session);
            }
            Ok(request(
                self.provider,
                1,
                if self.resume {
                    "session/load"
                } else {
                    "session/new"
                },
                params,
            ))
        }
    }
    pub(super) fn turn(&self) -> Value {
        if self.provider == Provider::Codex {
            request(
                self.provider,
                2,
                "turn/start",
                json!({"threadId":self.session,"input":[{"type":"text","text":self.prompt}]}),
            )
        } else {
            request(
                self.provider,
                2,
                "session/prompt",
                json!({"sessionId":self.session,"prompt":[{"type":"text",
                "text":format!("{}\n\n{}",include_str!("../prompt.md"),self.prompt)}]}),
            )
        }
    }
    // Replay notifications during ACP load are deliberately ignored until its response.
    pub(super) fn observe(&mut self, value: &Value) -> Result<bool, String> {
        if !self.active {
            return Ok(false);
        }
        if self.provider == Provider::Codex {
            let params = &value["params"];
            if let Some(thread) = params["threadId"].as_str() {
                if thread != self.session {
                    return Ok(false);
                }
            }
            match value["method"].as_str().unwrap_or("") {
                "error" => {
                    self.upstream_failures = self.upstream_failures.saturating_add(1);
                    if params["willRetry"] != true
                        || self.upstream_failures > MAX_CONSECUTIVE_CODEX_RETRIES
                    {
                        return Err(error(self.provider, params));
                    }
                }
                "item/started" if params["item"]["type"] == "fileChange" => {
                    if self.file_changes.len() < 256 {
                        if let Some(id) = params["item"]["id"].as_str() {
                            self.file_changes
                                .insert(id.into(), params["item"]["changes"].clone());
                        }
                    }
                }
                "item/completed" if params["item"]["type"] == "fileChange" => {
                    if let Some(id) = params["item"]["id"].as_str() {
                        self.file_changes.remove(id);
                    }
                }
                "item/agentMessage/delta" => {
                    self.upstream_failures = 0;
                    let id = params["itemId"].as_str().unwrap_or("");
                    if self.message != id {
                        self.message = id.into();
                        self.answer.clear();
                    }
                    if let Some(delta) = params["delta"].as_str() {
                        self.answer.push_str(delta);
                    }
                }
                "item/completed" if params["item"]["type"] == "agentMessage" => {
                    if let Some(text) = params["item"]["text"].as_str() {
                        self.answer = text.into();
                    }
                }
                "turn/completed" => {
                    return match params["turn"]["status"].as_str() {
                        Some("completed") => Ok(true),
                        Some("interrupted") => Err("任务已停止。".into()),
                        _ => Err(error(self.provider, &params["turn"]["error"])),
                    };
                }
                _ => {}
            }
        } else {
            if value["method"] == "session/update" && value["params"]["sessionId"] == self.session {
                let update = &value["params"]["update"];
                if update["sessionUpdate"] == "agent_message_chunk" {
                    if let Some(id) = update["messageId"].as_str() {
                        if self.message != id {
                            self.message = id.into();
                            self.answer.clear();
                        }
                    }
                    if let Some(text) = update["content"]["text"].as_str() {
                        self.answer.push_str(text);
                    }
                }
            }
            if value["id"] == 2 && value.get("method").is_none() {
                return match value["result"]["stopReason"].as_str() {
                    Some("end_turn") => Ok(true),
                    Some("cancelled") => Err("任务已停止。".into()),
                    _ => Err(format!(
                        "{} 未完成本次任务，请检查本地配置后重试。",
                        self.provider.name()
                    )),
                };
            }
        }
        Ok(false)
    }
}
