"""Pinned arxiv.py + actual loopback HTTP bridge. No arXiv requests."""
import base64
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
import requests
from arxiv_client import execute, session

FEED = '''<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
<opensearch:totalResults>{count}</opensearch:totalResults>{entry}</feed>'''
ENTRY = '''<entry><id>http://arxiv.org/abs/2610.12345v1</id><title>Diffusion for traffic</title>
<published>2026-10-23T00:00:00Z</published><updated>2026-10-23T00:00:00Z</updated>
<summary>Forecasting traffic with diffusion.</summary><author><name>Example Author</name></author>
<category term="cs.LG"/><arxiv:primary_category term="cs.LG"/>
<link title="pdf" href="http://arxiv.org/pdf/2610.12345v1" rel="related" type="application/pdf"/></entry>'''

class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.envelope = {"ok": True, "status": 200, "headers": {"content-type": "application/atom+xml"},
                         "body_base64": base64.b64encode(FEED.format(count=1, entry=ENTRY).encode()).decode()}
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                owner.calls.append((self.path, self.headers['X-Proxy-Token'], json.loads(self.rfile.read(int(self.headers['Content-Length'])))))
                body = json.dumps(owner.envelope).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.payload = {"query": 'all:"diffusion"', "gate_url": f'http://127.0.0.1:{self.server.server_port}/arxiv-request', "gate_token": 'a' * 64}
        self.original_send = requests.Session.send
        def guarded_send(session, request, **kwargs):
            self.assertTrue(request.url.startswith(self.payload['gate_url']))
            self.assertFalse(session.trust_env)
            return self.original_send(session, request, **kwargs)
        self.guard = patch('requests.Session.send', guarded_send)
        self.guard.start()
    def tearDown(self):
        self.guard.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
    def test_pinned_client_parses_through_local_bridge_only(self):
        result = execute(self.payload)
        self.assertEqual(len(self.calls), 1)
        path, token, data = self.calls[0]
        self.assertEqual(path, '/arxiv-request')
        self.assertEqual(token, 'a' * 64)
        self.assertEqual(data['method'], 'GET')
        self.assertTrue(data['url'].startswith('https://export.arxiv.org/api/query?'))
        self.assertEqual(result['papers'][0]['id'], 'arxiv:2610.12345v1')
        self.assertEqual(result['papers'][0]['categories'], ['cs.LG'])
    def test_429_is_returned_once_without_python_retry_or_sleep(self):
        detail = dict(code='rate_limited', phase='cooldown', attempts_started=1, request_id='fake', source='recommendations',
                      http_status=429, retry_after_seconds=900, cooldown_until='2030-01-01T00:00:00Z')
        self.envelope = dict(ok=False, gate_error=detail)
        with patch('time.sleep', side_effect=AssertionError('Python must not pace or retry')):
            self.assertEqual(execute(self.payload), dict(error='rate_limited', gate_error=detail))
        self.assertEqual(len(self.calls), 1)
    def test_all_gate_failures_remain_typed_and_no_retry_occurs(self):
        for code in ['queue_full', 'queue_timeout', 'request_timeout', 'total_timeout', 'cooldown', 'cancelled']:
            self.calls.clear()
            detail = dict(code=code, phase='request', attempts_started=0)
            self.envelope = dict(ok=False, gate_error=detail)
            self.assertEqual(execute(self.payload)['gate_error'], detail)
            self.assertEqual(len(self.calls), 1)
    def test_empty_and_malformed_feeds_keep_existing_validation(self):
        for body, valid in [(FEED.format(count=0, entry=''), True), ('<html>error</html>', False), (FEED.format(count=2, entry=''), False)]:
            self.envelope['body_base64'] = base64.b64encode(body.encode()).decode()
            result = execute(self.payload)
            self.assertEqual(result, {'papers': []} if valid else {'error': 'invalid_response'})
    def test_invalid_local_endpoint_or_public_target_is_never_sent(self):
        for endpoint in ['http://example.org/arxiv-request', 'http://127.0.0.1:1/other', 'https://127.0.0.1:1/arxiv-request']:
            with self.assertRaises(ValueError):
                session(endpoint, 'a' * 64)
        transport = session(self.payload['gate_url'], 'a' * 64)
        with self.assertRaises(ValueError):
            transport.get('https://arxiv.org/pdf/1706.03762')
        transport.close()
        self.assertEqual(self.calls, [])

if __name__ == '__main__':
    unittest.main()
