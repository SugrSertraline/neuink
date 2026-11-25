"""NeuInk adapter. Search, pagination and result parsing belong to upstream arxiv.py."""
import base64
import importlib.metadata
import json
import re
import sys
from urllib.parse import urlsplit
from xml.etree import ElementTree

VERSION = "4.0.1"
MAX_BYTES = 2 * 1024 * 1024


class GateFailure(Exception):
    def __init__(self, detail):
        self.detail = detail


def session(endpoint, token):
    import requests
    target = urlsplit(endpoint)
    if (target.scheme != "http" or target.hostname != "127.0.0.1" or not target.port
            or target.path != "/arxiv-request" or target.query or target.fragment
            or target.username or not isinstance(token, str) or not 32 <= len(token) <= 256):
        raise ValueError("invalid_gate")

    class GateSession(requests.Session):
        def __init__(self):
            super().__init__()
            self.trust_env = False
            self.host = requests.Session()
            self.host.trust_env = False

        def request(self, method, url, **kwargs):
            target = urlsplit(url)
            if (method.upper() != "GET" or target.scheme != "https"
                    or target.netloc != "export.arxiv.org" or target.path != "/api/query"
                    or target.fragment):
                raise ValueError("unexpected_endpoint")
            # No external HTTP escapes this adapter. The host owns pacing, retries and deadlines.
            with self.host.post(endpoint, headers={"X-Proxy-Token": token},
                                json={"url": url, "method": "GET"},
                                timeout=(5, 120), allow_redirects=False, stream=True) as result:
                result.raise_for_status()
                data = bytearray()
                for chunk in result.iter_content(16384):
                    data.extend(chunk)
                    if len(data) > 3 * 1024 * 1024:
                        raise ValueError("gate_response_too_large")
                envelope = json.loads(data)
            if envelope.get("ok") is not True:
                detail = envelope.get("gate_error")
                if not isinstance(detail, dict) or not isinstance(detail.get("code"), str):
                    raise ValueError("invalid_gate_response")
                raise GateFailure(detail)
            content = base64.b64decode(envelope["body_base64"], validate=True)
            if len(content) > MAX_BYTES:
                raise ValueError("response_too_large")
            response = requests.Response()
            response.status_code = int(envelope["status"])
            response.headers.update(envelope.get("headers", {}))
            response.url = url
            response._content = content
            response._content_consumed = True
            if response.status_code == 200:
                feed = ElementTree.fromstring(content)
                total = feed.find("{http://a9.com/-/spec/opensearch/1.1/}totalResults")
                if feed.tag != "{http://www.w3.org/2005/Atom}feed" or total is None:
                    raise ValueError("invalid_feed")
                count = int(total.text or "")
                if count < 0 or (count > 0 and not feed.findall("{http://www.w3.org/2005/Atom}entry")):
                    raise ValueError("invalid_feed")
            return response

        def close(self):
            self.host.close()
            super().close()

    return GateSession()


def paper(result):
    identity = result.get_short_id()
    if len(identity) > 100 or not re.fullmatch(r"[A-Za-z0-9./-]+", identity) or ".." in identity:
        raise ValueError("invalid_paper")
    return {
        "id": "arxiv:" + identity,
        "title": " ".join(result.title.split())[:1000],
        "authors": [author.name[:200] for author in result.authors[:40]],
        "year": str(result.published.year),
        "abstract_text": result.summary[:6000],
        "doi": (result.doi or "")[:300],
        "url": "https://arxiv.org/abs/" + identity,
        "pdf_url": "https://arxiv.org/pdf/" + identity if result.pdf_url else None,
        "provider": "arxiv", "evidence_level": "abstract",
        "published": result.published.isoformat(), "updated": result.updated.isoformat(),
        "categories": result.categories[:100], "reasons": [], "matched_interests": [],
    }


def execute(payload):
    import arxiv
    import requests

    if importlib.metadata.version("arxiv") != VERSION:
        return {"error": "version_mismatch"}
    if payload.get("action") == "check":
        return {"ready": True}
    query = payload.get("query")
    if not isinstance(query, str) or not query.strip() or len(query) > 10000:
        return {"error": "invalid_query"}
    client = arxiv.Client(page_size=40, delay_seconds=0, num_retries=0)
    # Pinned upstream exposes its requests session here. No search/parser fork is maintained.
    client._session.close()
    client._session = session(payload.get("gate_url", ""), payload.get("gate_token", ""))
    try:
        search = arxiv.Search(query=query, max_results=40,
                              sort_by=arxiv.SortCriterion.SubmittedDate,
                              sort_order=arxiv.SortOrder.Descending)
        return {"papers": [paper(result) for result in client.results(search)]}
    except GateFailure as error:
        return {"error": error.detail["code"], "gate_error": error.detail}
    except arxiv.HTTPError as error:
        return {"error": "http_error", "status": error.status}
    except requests.exceptions.Timeout:
        return {"error": "timeout"}
    except requests.exceptions.RequestException:
        return {"error": "connection"}
    except (ValueError, ElementTree.ParseError, arxiv.ArxivError):
        return {"error": "invalid_response"}
    finally:
        client._session.close()


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        output = execute(json.loads(sys.stdin.readline(20000)))
    except (ImportError, importlib.metadata.PackageNotFoundError):
        output = {"error": "dependencies"}
    except Exception:
        # Do not expose query text, paths or environment details in a traceback.
        output = {"error": "adapter_error"}
    print(json.dumps(output, ensure_ascii=True))
