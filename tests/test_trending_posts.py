import importlib.util
from datetime import datetime
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).parents[1] / "scripts/trending_posts.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)

SUMMARY = {"title": "Example review", "summary": "A source based review.",
           "features": ["Feature A", "Feature B"], "useCases": ["Case A", "Case B"],
           "gettingStarted": "Read the documentation.", "cautions": ["Check A", "Check B"]}

def repo(name, stars, daily):
    return {"name": name, "stars": stars, "todayStars": daily, "url": "https://github.com/" + name,
            "description": "Description", "language": "Python", "license": "MIT", "archived": False}


class PublisherTests(unittest.TestCase):
    def test_parser_ignores_unrelated_links(self):
        parser = p.TrendingParser()
        parser.feed('<a href="/wrong/repo">skip</a><article class="Box-row"><h2><a href="/owner/repo">owner / repo</a></h2><a href="/owner/repo/forks">20</a><span>1,234 stars today</span></article>')
        self.assertEqual(parser.rows, [{"name": "owner/repo", "todayStars": 1234}])

    def test_rank_total_and_daily(self):
        rows = [repo("a/a", 20, 100), repo("b/b", 100, 2), repo("c/c", 40, 30)]
        self.assertEqual([r["name"] for r in p.rank(rows, "total")][:2], ["b/b", "c/c"])
        self.assertEqual([r["name"] for r in p.rank(rows, "daily")][:2], ["a/a", "c/c"])

    def test_missing_daily_metric_is_not_zero(self):
        with self.assertRaises(RuntimeError):
            p.rank([repo("a/a", 20, None)], "daily")

    def test_validate_summary(self):
        p.validate_summary(SUMMARY)
        with self.assertRaises(ValueError):
            p.validate_summary({**SUMMARY, "features": []})

    def test_korean_day_boundary(self):
        utc = datetime.fromisoformat("2026-10-15T15:00:00+00:00")
        article = p.make_post(repo("a/a", 12, 2), SUMMARY, "https://github.com/a/a/readme", utc, "total")
        self.assertEqual(article["publicationDay"], "2026-10-16")
        self.assertIn("https://github.com/a/a/readme", article["content"])

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"})
    def test_atomic_publication_and_same_day_idempotency(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "feed.json"
            now = datetime(2026, 10, 16, 9, tzinfo=p.KST)
            with patch.object(p, "candidates", return_value=[repo("a/a", 100, 1), repo("b/b", 90, 2)]), \
                 patch.object(p, "readme", return_value=("readme", "https://github.com/a/a/readme")), \
                 patch.object(p, "summarize", return_value=SUMMARY) as summary:
                result = p.publish(target, now=now)
                self.assertEqual(result["count"], 2)
                self.assertEqual(len(json.loads(target.read_text(encoding="utf-8"))["posts"]), 2)
                self.assertEqual(p.publish(target, now=now)["status"], "already-published")
                self.assertEqual(summary.call_count, 2)

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"})
    def test_second_summary_failure_preserves_existing_feed(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "feed.json"
            original = '{"version":1,"posts":[]}'
            target.write_text(original, encoding="utf-8")
            with patch.object(p, "candidates", return_value=[repo("a/a", 100, 1), repo("b/b", 90, 2)]), \
                 patch.object(p, "readme", return_value=("readme", "https://github.com/a/a/readme")), \
                 patch.object(p, "summarize", side_effect=[SUMMARY, RuntimeError("failure")]):
                with self.assertRaises(RuntimeError):
                    p.publish(target)
            self.assertEqual(target.read_text(encoding="utf-8"), original)
            self.assertFalse(target.with_suffix(".lock").exists())

    def test_lock_rejects_concurrent_run(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "feed.json"
            with p.publication_lock(target):
                with self.assertRaises(RuntimeError):
                    with p.publication_lock(target):
                        pass

    def test_corrupt_feed_not_overwritten(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "feed.json"
            target.write_text('{"version":1,"posts":[null]}', encoding="utf-8")
            with self.assertRaises(ValueError):
                p.load_feed(target)

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-only"})
    def test_model_refusal_is_not_published(self):
        with patch.object(p, "request", return_value='{"status":"completed","output":[{"type":"message","content":[{"type":"refusal","refusal":"no"}]}]}'):
            with self.assertRaises(ValueError):
                p.summarize(repo("a/a", 10, 1), "readme")


if __name__ == "__main__":
    unittest.main()
