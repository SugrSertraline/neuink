"""Exercise the installed upstream client with a controlled HTTP transport, never live arXiv."""
import io
import unittest
from unittest.mock import patch

import requests
from arxiv_client import execute, retry_seconds

FEED = '''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
<opensearch:totalResults>{count}</opensearch:totalResults>{entry}</feed>'''
ENTRY = '''<entry><id>http://arxiv.org/abs/2610.12345v1</id><title>Diffusion for traffic</title>
<published>2026-10-23T00:00:00Z</published><updated>2026-10-23T00:00:00Z</updated>
<summary>Forecasting traffic with diffusion.</summary><author><name>Example Author</name></author>
<category term="cs.LG"/><arxiv:primary_category term="cs.LG"/>
<link title="pdf" href="http://arxiv.org/pdf/2610.12345v1" rel="related" type="application/pdf"/></entry>'''


def response(body, status=200, headers=None):
    result = requests.Response()
    result.status_code = status
    result.headers.update(headers or {})
    result.raw = io.BytesIO(body.encode())
    return result


class ArxivAdapterTests(unittest.TestCase):
    def test_upstream_client_parses_real_atom_and_adapter_preserves_metadata(self):
        with patch("requests.Session.send", return_value=response(FEED.format(count=1, entry=ENTRY))) as send:
            result = execute({"query": 'all:"diffusion"'})
        self.assertEqual(send.call_count, 1)
        self.assertIn("export.arxiv.org/api/query?", send.call_args.args[0].url)
        self.assertEqual(send.call_args.kwargs["timeout"], (15, 45))
        self.assertFalse(send.call_args.kwargs["allow_redirects"])
        paper = result["papers"][0]
        self.assertEqual(paper["id"], "arxiv:2610.12345v1")
        self.assertEqual(paper["authors"], ["Example Author"])
        self.assertEqual(paper["categories"], ["cs.LG"])
        self.assertEqual(paper["pdf_url"], "https://arxiv.org/pdf/2610.12345v1")
        self.assertEqual(paper["evidence_level"], "abstract")

    def test_rate_limit_does_not_retry_and_retains_server_deadline(self):
        with patch("requests.Session.send", return_value=response("limited", 429, {"Retry-After": "900"})) as send:
            result = execute({"query": "diffusion"})
        self.assertEqual(send.call_count, 1)
        self.assertEqual(result, {"error": "rate_limited", "retry_after_seconds": 900})

    def test_only_valid_empty_feed_can_complete_a_day(self):
        with patch("requests.Session.send", return_value=response(FEED.format(count=0, entry=""))):
            self.assertEqual(execute({"query": "diffusion"}), {"papers": []})
        for body in ["<html>temporary error</html>", FEED.format(count=4, entry=""), "broken xml"]:
            with patch("requests.Session.send", return_value=response(body)):
                self.assertEqual(execute({"query": "diffusion"})["error"], "invalid_response")

    def test_timeout_is_a_failure_and_not_an_empty_result(self):
        with patch("requests.Session.send", side_effect=requests.exceptions.Timeout):
            self.assertEqual(execute({"query": "diffusion"}), {"error": "timeout"})

    def test_response_limit_prevents_unbounded_buffering(self):
        with patch("requests.Session.send", return_value=response("x" * (2 * 1024 * 1024 + 1))):
            self.assertEqual(execute({"query": "diffusion"})["error"], "invalid_response")

    def test_retry_deadlines_are_bounded_and_have_a_conservative_default(self):
        self.assertEqual(retry_seconds(None), 300)
        self.assertEqual(retry_seconds("10"), 60)
        self.assertEqual(retry_seconds("900"), 900)
        self.assertEqual(retry_seconds("999999"), 86400)


if __name__ == "__main__":
    unittest.main()
