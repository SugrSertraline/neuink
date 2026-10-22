use super::Provider;
use serde_json::{json, Value};

pub(super) fn approval_input(provider: Provider, message: &Value) -> Option<Value> {
    let params = &message["params"];
    match message["method"].as_str()? {
        "mcpServer/elicitation/request" if provider == Provider::Codex => {
            let meta = &params["_meta"];
            // Codex sends MCP tool approvals as elicitations, separately from
            // command/file approvals. Tool names are optional in the metadata;
            // the NeuInk MCP server still validates every actual tool call.
            let own_tool_approval = params["serverName"] == "neuink"
                && params["mode"] == "form"
                && meta["codex_approval_kind"] == "mcp_tool_call";
            let name = if own_tool_approval {
                meta["tool_name"].as_str().and_then(|name| {
                    let name = name.strip_prefix("mcp__neuink__").unwrap_or(name);
                    (!name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
                        .then(|| format!("mcp__neuink__{name}"))
                }).or_else(|| meta["tool_name"].is_null().then(|| "mcp__neuink__".into()))
            } else {
                None
            };
            Some(json!({"tool_name":name.unwrap_or_else(|| "McpElicitation".into()),
                "input":meta["tool_params"].as_object().map(|_|meta["tool_params"].clone()).unwrap_or_else(||json!({}))}))
        }
        "item/commandExecution/requestApproval" => Some(json!({"tool_name":"Bash","input":params})),
        "item/fileChange/requestApproval" => Some(json!({"tool_name":"Edit","input":params})),
        "item/permissions/requestApproval" => {
            Some(json!({"tool_name":"Permissions","input":params}))
        }
        "item/tool/requestUserInput" => {
            let questions = params["questions"].as_array()?.iter().map(|q| json!({"question":q["question"],"options":q["options"],"multiSelect":false})).collect::<Vec<_>>();
            Some(json!({"tool_name":"AskUserQuestion","input":{"questions":questions}}))
        }
        "session/request_permission" if provider == Provider::Opencode => {
            let tool = &params["toolCall"];
            let name = match tool["kind"].as_str() {
                Some("edit") => "Edit",
                Some("execute") => "Bash",
                _ => tool["name"]
                    .as_str()
                    .or_else(|| tool["title"].as_str())
                    .unwrap_or("本地工具"),
            };
            Some(
                json!({"tool_name":name,"input":{"rawInput":tool["rawInput"],"locations":tool["locations"],"content":tool["content"],"title":tool["title"]}}),
            )
        }
        _ => None,
    }
}
pub(super) fn approval_result(provider: Provider, request: &Value, output: &Value) -> Value {
    let decision = output["content"]
        .as_array()
        .and_then(|blocks| blocks.first())
        .and_then(|block| block["text"].as_str())
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .unwrap_or(Value::Null);
    let allow = decision["behavior"] == "allow" && output["isError"] != true;
    match request["method"].as_str().unwrap_or("") {
        "mcpServer/elicitation/request" if provider == Provider::Codex => {
            json!({"action":if allow {"accept"} else {"decline"},"content":if allow {json!({})} else {Value::Null}})
        }
        "session/request_permission" if provider == Provider::Opencode => {
            let option = request["params"]["options"].as_array().and_then(|options| {
                options.iter().find(|option| {
                    option["kind"] == if allow { "allow_once" } else { "reject_once" }
                })
            });
            option.map(|option|json!({"outcome":{"outcome":"selected","optionId":option["optionId"]}}))
                .unwrap_or_else(||json!({"outcome":{"outcome":"cancelled"}}))
        }
        "item/permissions/requestApproval" => {
            json!({"permissions":if allow {request["params"]["permissions"].clone()} else {json!({})},"scope":"turn"})
        }
        "item/tool/requestUserInput" => {
            let mut answers = serde_json::Map::new();
            if let Some(questions) = request["params"]["questions"].as_array() {
                for question in questions {
                    if let Some(id) = question["id"].as_str() {
                        let key = question["question"].as_str().unwrap_or("");
                        let answer = decision["updatedInput"]["answers"][key]
                            .as_str()
                            .unwrap_or("");
                        answers.insert(
                            id.into(),
                            json!({"answers":if allow {vec![answer]} else {vec![]}}),
                        );
                    }
                }
            }
            json!({"answers":answers})
        }
        _ => json!({"decision":if allow {"accept"} else {"decline"}}),
    }
}
