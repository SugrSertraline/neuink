"""Deterministic checks against the original engine; no paid model or real papers."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import runner


class AdapterTests(unittest.TestCase):
    def test_config_keeps_secrets_in_environment_and_restricts_tools(self):
        cfg = runner.configuration({"model": "test", "base_url": "https://example.com/v1", "api_key": "private-secret"}, Path("test"))
        self.assertNotIn("private-secret", json.dumps(cfg))
        policy = cfg["authorization"]["provider"]["config"]["roles"]["user"]
        # The original middleware allocates a host-owned temp workspace; no file/shell tools are granted.
        self.assertEqual(policy["sandbox"]["allow"], "*")
        self.assertNotIn("bash", policy["tools"]["allow"])
        self.assertFalse(cfg["memory"]["enabled"])
        self.assertEqual(cfg["database"]["backend"], "memory")

    def test_sources_come_only_from_actual_tool_results(self):
        self.assertEqual(runner.public_urls({"results": [{"url": "https://arxiv.org/abs/1706.03762"}, {"url": "file:///secret"}, {"url": "https://user:pass@example.com"}]}), ["https://arxiv.org/abs/1706.03762"])

    @unittest.skipUnless(os.getenv("NEUINK_RESEARCH_TEST_PYTHON"), "Requires original bundled engine")
    def test_original_engine_searches_and_answers_through_host_tools(self):
        calls, searches, tool_names = [], [], set()

        class Handler(BaseHTTPRequestHandler):
            fail = False
            def log_message(self, *_): pass
            def do_GET(self):
                searches.append(self.path)
                body = json.dumps({"academic": {"papers": [{"title": "Attention Is All You Need", "url": "https://arxiv.org/abs/1706.03762", "abstract_text": "Transformer uses attention.", "evidence_level": "abstract"}]}}).encode()
                self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append(request)
                if self.fail:
                    self.send_response(402); self.send_header("Content-Type", "application/json"); self.end_headers()
                    self.wfile.write(json.dumps({"error":{"message":"Insufficient Balance private-error-detail", "type":"insufficient_balance_error"}}).encode())
                    return
                tool_names.update(t["function"]["name"] for t in request.get("tools", []))
                has_result = any(m["role"] == "tool" for m in request["messages"])
                delta = {"role": "assistant", "content": "基于[原论文摘要](https://arxiv.org/abs/1706.03762)，Transformer 使用注意力。摘要证据不足以比较完整实验。"} if has_result else {
                    "role": "assistant", "tool_calls": [{"index": 0, "id": "call_search", "type": "function", "function": {"name": "search_sources", "arguments": '{"query":"attention transformer"}'}}]}
                self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
                for chunk in [{"id": "reply-2" if has_result else "reply-1", "object": "chat.completion.chunk", "created": 1, "model": "test", "choices": [{"index": 0, "delta": delta, "finish_reason": None}]},
                              {"id": "reply-2" if has_result else "reply-1", "object": "chat.completion.chunk", "created": 1, "model": "test", "choices": [{"index": 0, "delta": {}, "finish_reason": "stop" if has_result else "tool_calls"}]}]:
                    self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                endpoint = "http://127.0.0.1:" + str(server.server_port)
                payload = {"query": "解释 Transformer，提供引用。", "profile": {"api_protocol": "openai_compatible", "model": "test", "base_url": endpoint + "/v1", "api_key": "private-test-key"},
                           "temporary_parent": directory, "retriever_endpoint": endpoint + "/search", "documents": [{"id": "public", "title": "Public abstract", "text": "Attention replaces recurrence.", "evidence_level": "abstract"}]}
                result = subprocess.run([os.environ["NEUINK_RESEARCH_TEST_PYTHON"], "-I", str(Path(runner.__file__).resolve())], input=json.dumps(payload),
                                        text=True, encoding="utf-8", capture_output=True, timeout=90)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                events = [json.loads(line) for line in result.stdout.splitlines()]
                final = next(e for e in events if e["type"] == "result")
                self.assertIn("Transformer", final["report"])
                self.assertEqual(final["source_urls"], ["https://arxiv.org/abs/1706.03762"], str(events))
                self.assertEqual(final["local_sources"], ["public"])
                self.assertGreaterEqual(len(calls), 2); self.assertTrue(searches)
                self.assertFalse(any(m["role"] == "tool" for m in calls[0]["messages"]))
                system = " ".join(str(m["content"]) for m in calls[0]["messages"] if m["role"] == "system")
                self.assertIn("full final answer directly in chat in Chinese", system)
                self.assertIn("no shell, file writing or installation", system)
                self.assertNotIn("bash", tool_names); self.assertNotIn("write_file", tool_names)
                self.assertIn("task", tool_names)
                self.assertNotIn("private-test-key", result.stdout + result.stderr)
                self.assertNotIn("private-test-key", (Path(directory) / "config.yaml").read_text())
                Handler.fail = True
                failed = subprocess.run([os.environ["NEUINK_RESEARCH_TEST_PYTHON"], "-I", str(Path(runner.__file__).resolve())], input=json.dumps(payload), text=True, encoding="utf-8", capture_output=True, timeout=90)
                self.assertNotEqual(failed.returncode, 0)
                failed_events = [json.loads(line) for line in failed.stdout.splitlines()]
                self.assertFalse(any(e["type"] == "result" for e in failed_events))
                self.assertEqual(failed_events[-1]["code"], "provider_quota")
                self.assertNotIn("private-error-detail", failed.stdout + failed.stderr)
                self.assertNotIn("private-test-key", failed.stdout + failed.stderr)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__": unittest.main()
