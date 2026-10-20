import asyncio
import copy
from dataclasses import replace
import importlib.util
import json
import re
from pathlib import Path
import unittest
from unittest.mock import patch

from src.ai_mistake import (AIError, Classifier, Config, DEFAULT_RULES, DeepSeekProvider,
                            MockProvider, _read_body, _validate_rules, _with_disconnect,
                            fallback, normalize_result, parse_input)

FULL = {"question": "1+1=?", "student_answer": "3", "error_type": "careless"}


class ContractTests(unittest.TestCase):
    def test_documented_suggestion_modes_and_fallback_are_normalized(self):
        modes = ['choice_reproduction', 'standard', 'cloze', 'self_explain', 'reading', 'contrast', 'retry']
        plan = Path(__file__).resolve().parents[2] / 'docs/review-system-master-plan.md'
        # Read the authoritative mode list, excluding the per-mode editing table below it.
        mode_table = plan.read_text(encoding='utf-8').split('## 3. 模式清单', 1)[1].split('### 3.1', 1)[0]
        documented = re.findall(r'^\| `([a-z_]+)`', mode_table, re.M)
        self.assertEqual(documented, modes)
        self.assertEqual([c['id'] for c in DEFAULT_RULES['categories']], modes + ['unclassified'])
        for mode in modes + ['unclassified']:
            self.assertEqual(normalize_result({'review_method': mode, 'reason': '演示', 'needs_review': True}, DEFAULT_RULES)['review_method'], mode)
        for legacy in ['recall', 'guided']:
            self.assertIsNone(normalize_result({'review_method': legacy, 'reason': '旧值', 'needs_review': True}, DEFAULT_RULES))

    def test_rules_match_original_node_file_exactly(self):
        original = Path(__file__).resolve().parents[2] / "ai-service/config/classification.json"
        self.assertEqual(DEFAULT_RULES, json.loads(original.read_text(encoding="utf-8")))

    def test_config_defaults_and_explicit_real_opt_in(self):
        self.assertEqual(Config.from_env({}).provider, "mock")
        with self.assertRaises(ValueError):
            Config.from_env({"AI_PROVIDER": "deepseek", "DEEPSEEK_API_KEY": "synthetic"})
        with self.assertRaises(ValueError):
            Config.from_env({"AI_PROVIDER": "deepseek", "AI_ENABLE_REAL": "true"})
        config = Config.from_env({"AI_PROVIDER": "deepseek", "AI_ENABLE_REAL": "true", "DEEPSEEK_API_KEY": "synthetic"})
        self.assertEqual(config.provider, "deepseek")
        self.assertNotIn("synthetic", repr(config))

    def test_mock_does_not_read_a_model_key(self):
        class Guarded(dict):
            def get(self, key, default=None):
                if key == "DEEPSEEK_API_KEY":
                    raise AssertionError("must not read key")
                return super().get(key, default)
        self.assertEqual(Config.from_env(Guarded()).api_key, "")

    def test_invalid_config_is_rejected(self):
        for env in [{"AI_PROVIDER": "unknown"}, {"AI_KEY_MODE": "user"}, {"AI_TIMEOUT_MS": ""},
                    {"AI_TIMEOUT_MS": "0"}, {"AI_MAX_CONCURRENT": "101"}, {"DEEPSEEK_MODEL": "unknown"}]:
            with self.subTest(env=list(env)), self.assertRaises(ValueError):
                Config.from_env(env)

    def test_input_unknown_types_and_future_fields_rejected(self):
        for body in [None, [], 1, {"question": None}, {"question": 1}, {"question": True},
                     {"question": {}}, {"question": "x" * 4001}]:
            self.assertIsNone(parse_input(body))
        for field in ["api_key", "user_id", "image", "course_id", "provider", "model", "mistake_type", "note_text"]:
            self.assertIsNone(parse_input({**FULL, field: "x"}))

    def test_utf16_and_ecmascript_trim_match_node(self):
        self.assertIsNotNone(parse_input({"question": "😀" * 2000}))
        self.assertIsNone(parse_input({"question": "😀" * 2001}))
        self.assertEqual(parse_input({"question": "\ufeff x \ufeff"}), {"question": "x"})
        self.assertEqual(parse_input({"question": "\u0085"}), {"question": "\u0085"})

    def test_result_validation_and_forced_manual_review(self):
        for value in [None, [], {}, {"review_method": [], "reason": "x", "needs_review": True},
                      {"review_method": "invented", "reason": "x", "needs_review": True},
                      {"review_method": "retry", "reason": "x" * 501, "needs_review": True},
                      {"review_method": "retry", "reason": " ", "needs_review": True},
                      {"review_method": "retry", "reason": "x", "needs_review": 1}]:
            self.assertIsNone(normalize_result(value, DEFAULT_RULES))
        self.assertEqual(normalize_result({"review_method": "retry", "reason": " x ", "needs_review": False,
                                           "secret": "discard"}, DEFAULT_RULES),
                         {"review_method": "retry", "reason": "x", "needs_review": True})

    def test_rule_validation_rejects_missing_fallback_or_ambiguous_types(self):
        rules = copy.deepcopy(DEFAULT_RULES)
        rules["categories"].pop()
        with self.assertRaises(ValueError):
            _validate_rules(rules)
        rules = copy.deepcopy(DEFAULT_RULES)
        rules["categories"][1]["error_types"] = ["careless"]
        with self.assertRaises(ValueError):
            _validate_rules(rules)


class CoreAsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_four_mock_categories_and_no_network(self):
        with patch.object(DeepSeekProvider, "classify", side_effect=AssertionError("network forbidden")):
            classifier = Classifier(Config())
            for error_type, expected in [("knowledge_gap", "cloze"), ("reasoning_gap", "self_explain"),
                                         ("careless", "retry"), ("unknown", "unclassified")]:
                result, source = await classifier.classify({**FULL, "error_type": error_type})
                self.assertEqual((result["review_method"], source, result["needs_review"]), (expected, "provider", True))

    async def test_insufficient_evidence_never_calls_provider(self):
        class Never:
            async def classify(self, *_):
                raise AssertionError("must not call")
        classifier = Classifier(Config(), provider=Never())
        for body in [{}, {"question": "x"}, {"error_type": "careless"}, {**FULL, "question": " "}]:
            self.assertEqual(await classifier.classify(body), (fallback(), "input_fallback"))

    async def test_invalid_output_falls_back_and_exception_is_sanitized(self):
        class Bad:
            async def classify(self, *_):
                return {"review_method": "invented"}
        self.assertEqual(await Classifier(Config(), provider=Bad()).classify(FULL), (fallback(), "validation_fallback"))
        class Broken:
            def classify(self, *_):
                raise RuntimeError("synthetic-sensitive-marker")
        with self.assertRaises(AIError) as error:
            await Classifier(Config(), provider=Broken()).classify(FULL)
        self.assertEqual((error.exception.status, str(error.exception)), (502, "AI_UNAVAILABLE"))

    async def test_timeout_cancels_work(self):
        cancelled = asyncio.Event()
        class Slow:
            async def classify(self, *_):
                try:
                    await asyncio.sleep(10)
                finally:
                    cancelled.set()
        classifier = Classifier(replace(Config(), timeout_ms=10), provider=Slow())
        with self.assertRaises(AIError) as error:
            await classifier.classify(FULL)
        self.assertEqual((error.exception.status, error.exception.code), (504, "AI_TIMEOUT"))
        await asyncio.wait_for(cancelled.wait(), 1)
        await asyncio.sleep(0)
        self.assertFalse(classifier.tasks)

    async def test_timed_out_uncooperative_work_retains_capacity(self):
        gate, cancelled = asyncio.Event(), asyncio.Event()
        class Slow:
            async def classify(self, *_):
                try:
                    await gate.wait()
                except asyncio.CancelledError:
                    cancelled.set()
                    await gate.wait()
                return await MockProvider().classify(FULL, DEFAULT_RULES)
        classifier = Classifier(replace(Config(), timeout_ms=10, max_concurrent=1), provider=Slow())
        try:
            with self.assertRaises(AIError) as error:
                await classifier.classify(FULL)
            self.assertEqual(error.exception.code, "AI_TIMEOUT")
            await asyncio.wait_for(cancelled.wait(), 1)
            with self.assertRaises(AIError) as error:
                await classifier.classify(FULL)
            self.assertEqual(error.exception.code, "AI_BUSY")
            self.assertEqual(await classifier.classify({}), (fallback(), "input_fallback"))
        finally:
            gate.set()
            await asyncio.gather(*classifier.tasks)
            await asyncio.sleep(0)
        self.assertFalse(classifier.tasks)

    async def test_process_rate_limit_and_retry_after(self):
        classifier = Classifier(replace(Config(), rate_max=1))
        classifier.check_rate()
        with self.assertRaises(AIError) as error:
            classifier.check_rate()
        self.assertEqual(error.exception.code, "RATE_LIMITED")
        self.assertGreaterEqual(error.exception.retry_after, 1)

    async def test_body_stream_limit_encoding_and_json_errors(self):
        class Request:
            def __init__(self, data, headers=None):
                self.data = data
                self.headers = {"content-type": "application/json; charset=utf-8", **(headers or {})}
            async def stream(self):
                for i in range(0, len(self.data), 1024):
                    yield self.data[i:i + 1024]
        self.assertEqual(await _read_body(Request(b"{}")), {})
        for data, headers, code in [(b"{", {}, "INVALID_JSON"), (b"null", {}, "INVALID_JSON"),
                                     (b"{\"question\":NaN}", {}, "INVALID_JSON"),
                                     (b"x" * 16385, {}, "BODY_TOO_LARGE"),
                                     (b"{}", {"content-type": "text/plain"}, "JSON_REQUIRED"),
                                     (b"{}", {"content-encoding": "gzip"}, "UNSUPPORTED_ENCODING")]:
            with self.assertRaises(AIError) as error:
                await _read_body(Request(data, headers))
            self.assertEqual(error.exception.code, code)

    async def test_disconnect_cancels_provider(self):
        cancelled, started = asyncio.Event(), asyncio.Event()
        class Slow:
            async def classify(self, *_):
                started.set()
                try:
                    await asyncio.sleep(10)
                finally:
                    cancelled.set()
        class Request:
            async def is_disconnected(self):
                return started.is_set()
        classifier = Classifier(Config(), provider=Slow())
        with self.assertRaises(AIError) as error:
            await _with_disconnect(Request(), classifier, FULL)
        self.assertEqual(error.exception.code, "CLIENT_DISCONNECTED")
        await asyncio.wait_for(cancelled.wait(), 1)


@unittest.skipUnless(importlib.util.find_spec("httpx"), "httpx is not installed")
class UpstreamTests(unittest.IsolatedAsyncioTestCase):
    async def invoke(self, handler):
        import httpx
        config = Config(provider="deepseek", api_key="synthetic-fake-key")
        return await Classifier(config, provider=DeepSeekProvider(config, transport=httpx.MockTransport(handler))).classify(FULL)

    async def test_protocol_matches_node_and_result_is_normalized(self):
        import httpx
        def handler(request):
            self.assertEqual(str(request.url), "https://api.deepseek.com/chat/completions")
            self.assertEqual(request.headers["authorization"], "Bearer synthetic-fake-key")
            body = json.loads(request.content)
            self.assertEqual(body["max_tokens"], 512)
            self.assertEqual(body["thinking"], {"type": "disabled"})
            self.assertEqual(body["response_format"], {"type": "json_object"})
            self.assertEqual(json.loads(body["messages"][1]["content"]), FULL)
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(
                {"review_method": "retry", "reason": "mock upstream", "needs_review": False})}}]})
        result, source = await self.invoke(handler)
        self.assertEqual((result["needs_review"], source), (True, "provider"))

    async def test_upstream_errors_and_redirects_never_leak_body(self):
        import httpx
        for upstream, status, code in [(401, 502, "AI_AUTH_FAILED"), (402, 503, "AI_BALANCE_UNAVAILABLE"),
                                       (429, 503, "AI_UPSTREAM_RATE_LIMITED"), (500, 502, "AI_UNAVAILABLE"),
                                       (302, 502, "AI_UNAVAILABLE")]:
            with self.subTest(upstream=upstream), self.assertRaises(AIError) as error:
                await self.invoke(lambda request: httpx.Response(upstream, text="sensitive-marker",
                                                                 headers={"location": "https://never.invalid"}))
            self.assertEqual((error.exception.status, error.exception.code), (status, code))
            self.assertNotIn("sensitive-marker", str(error.exception))

    async def test_large_invalid_and_truncated_output(self):
        import httpx
        for content in [b"x" * 65537, b"{", json.dumps({"choices": [{"finish_reason": "length"}]}).encode()]:
            with self.assertRaises(AIError) as error:
                await self.invoke(lambda request: httpx.Response(200, content=content))
            self.assertEqual(error.exception.code, "AI_UNAVAILABLE")

    async def test_timeout_includes_stream_body_read(self):
        import httpx
        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                await asyncio.sleep(10)
                yield b"{}"
        config = Config(provider="deepseek", api_key="synthetic", timeout_ms=10)
        provider = DeepSeekProvider(config, transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=Body())))
        with self.assertRaises(AIError) as error:
            await Classifier(config, provider=provider).classify(FULL)
        self.assertEqual(error.exception.code, "AI_TIMEOUT")


if __name__ == "__main__":
    unittest.main()
