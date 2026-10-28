"""NeuInk adapter. Search, pagination and result parsing belong to upstream arxiv.py."""
import importlib.metadata
import json
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from xml.etree import ElementTree

VERSION = "4.0.1"
MAX_BYTES = 2 * 1024 * 1024


class RateLimited(Exception):
    def __init__(self, seconds):
        self.seconds = seconds


def retry_seconds(value):
    try:
        seconds = int(value)
    except (ValueError, TypeError):
        try:
            seconds = int((parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            seconds = 300
    return max(60, min(seconds, 86400))


def session():
    import requests

    class BoundedSession(requests.Session):
        def __init__(self):
            super().__init__()
            self.trust_env = False  # Do not inherit credentials, proxies or .netrc.

        def request(self, method, url, **kwargs):
            target = urlsplit(url)
            if (method.upper() != "GET" or target.scheme != "https"
                    or target.netloc != "export.arxiv.org" or target.path != "/api/query"):
                raise ValueError("unexpected_endpoint")
            kwargs.update(timeout=(15, 45), allow_redirects=False, stream=True)
            with super().request(method, url, **kwargs) as response:
                # Stop immediately on 429; the host persists the retry deadline across restarts.
                if response.status_code == 429:
                    raise RateLimited(retry_seconds(response.headers.get("Retry-After")))
                data = bytearray()
                for chunk in response.iter_content(16384):
                    data.extend(chunk)
                    if len(data) > MAX_BYTES:
                        raise ValueError("response_too_large")
                if response.status_code == 200:
                    # Upstream can tolerate malformed feeds; never cache an HTML error as an empty day.
                    feed = ElementTree.fromstring(data)
                    total = feed.find("{http://a9.com/-/spec/opensearch/1.1/}totalResults")
                    if feed.tag != "{http://www.w3.org/2005/Atom}feed" or total is None:
                        raise ValueError("invalid_feed")
                    count = int(total.text or "")
                    if count < 0 or (count > 0 and not feed.findall("{http://www.w3.org/2005/Atom}entry")):
                        raise ValueError("invalid_feed")
                response._content = bytes(data)
                response._content_consumed = True
                return response

    return BoundedSession()


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
    client = arxiv.Client(page_size=40, delay_seconds=3, num_retries=1)
    # Pinned upstream exposes its requests session here. No search/parser fork is maintained.
    client._session.close()
    client._session = session()
    try:
        search = arxiv.Search(query=query, max_results=40,
                              sort_by=arxiv.SortCriterion.SubmittedDate,
                              sort_order=arxiv.SortOrder.Descending)
        return {"papers": [paper(result) for result in client.results(search)]}
    except RateLimited as error:
        return {"error": "rate_limited", "retry_after_seconds": error.seconds}
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
