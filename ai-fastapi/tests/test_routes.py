import importlib.util
import unittest
from unittest.mock import patch
from src.ai_mistake import Config, PATH, register

AVAILABLE = bool(importlib.util.find_spec("fastapi") and importlib.util.find_spec("httpx"))


@unittest.skipUnless(AVAILABLE, "FastAPI/httpx missing; no dependencies installed automatically")
class RouteTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, *, allowed=False, content=b"{}", headers=None):
        from fastapi import Depends, FastAPI
        import httpx
        app = FastAPI()
        async def host_auth():
            pass  # Test double only, never a production authentication implementation.
        register(app, dependencies=[Depends(host_auth)] if allowed else None, config=Config())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            return await client.post(PATH, content=content, headers={"Content-Type": "application/json", **(headers or {})})

    async def test_default_registration_denies_forged_identity_before_parsing(self):
        response = await self.request(content=b"{", headers={"Authorization": "Bearer forged", "X-User-ID": "admin"})
        self.assertEqual((response.status_code, response.json()), (503, {"error": "AI_AUTH_NOT_CONFIGURED"}))

    async def test_mock_success_fallback_and_headers(self):
        response = await self.request(allowed=True, content=b'{"question":"x","student_answer":"y","error_type":"careless"}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["review_method"], "retry")
        self.assertEqual(response.headers["x-ai-provider"], "mock")
        self.assertEqual(response.headers["x-ai-result-source"], "provider")
        self.assertEqual(response.headers["cache-control"], "no-store")
        response = await self.request(allowed=True)
        self.assertEqual(response.headers["x-ai-result-source"], "input_fallback")

    async def test_input_errors_are_json_and_do_not_leak(self):
        for body, expected in [(b"{", "INVALID_JSON"), (b'{"user_id":"forged"}', "INVALID_INPUT"),
                               (b"x" * 16385, "BODY_TOO_LARGE")]:
            response = await self.request(allowed=True, content=body)
            self.assertEqual(response.json(), {"error": expected})

    async def test_host_permission_denial_does_not_call_provider(self):
        from fastapi import Depends, FastAPI, HTTPException
        import httpx
        app = FastAPI()
        async def deny():
            raise HTTPException(status_code=403, detail="AI_FORBIDDEN")
        register(app, dependencies=[Depends(deny)], config=Config())
        with patch("src.ai_mistake.MockProvider.classify", side_effect=AssertionError("must not call")):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                self.assertEqual((await client.post(PATH, json={})).status_code, 403)

    async def test_registration_does_not_replace_other_routes_and_rejects_duplicates(self):
        from fastapi import FastAPI
        import httpx
        app = FastAPI()
        @app.get("/existing")
        async def existing():
            return {"unchanged": True}
        register(app, config=Config())
        with self.assertRaises(ValueError):
            register(app, config=Config())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            self.assertEqual((await client.get("/existing")).json(), {"unchanged": True})


if __name__ == "__main__":
    unittest.main()
