import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import Depends, FastAPI

from src.ai_outline import OutlineProvider, register


class OutlineTests(unittest.IsolatedAsyncioTestCase):
    def app(self):
        app = FastAPI()

        async def allowed():
            pass

        register(app, dependencies=[Depends(allowed)])
        return app

    async def request(self, body):
        async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=self.app()), base_url='http://test') as client:
            return await client.post('/api/ai/outline-polish', json=body)

    @property
    def body(self):
        return {
            'provider': 'deepseek',
            'api_key': 'synthetic-outline-key',
            'model': 'deepseek-flash',
            'confirm_cost': True,
            'input': {'title': '函数复习', 'text': '第一章 函数；一、极限；1. 定义；2. 运算；二、连续'},
        }

    async def test_polishes_to_validated_plain_outline_and_redacts_key(self):
        result = {
            'title': '函数复习',
            'outline': '- 函数\n  - 极限\n    - 定义\n    - 运算\n  - 连续',
            'needs_review': True,
        }

        def handler(request):
            return httpx.Response(200, json={
                'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(result)}}],
            })

        with patch('src.ai_outline.OutlineProvider',
                   side_effect=lambda config: OutlineProvider(config, transport=httpx.MockTransport(handler))):
            response = await self.request(self.body)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['result'], result)
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertNotIn('synthetic-outline-key', response.text)

    async def test_rejects_missing_text_and_invalid_hierarchy(self):
        empty = {**self.body, 'input': {'title': '函数复习', 'text': ''}}
        self.assertEqual((await self.request(empty)).status_code, 400)

        invalid = {
            'title': '函数复习',
            'outline': '  - 根节点不能缩进\n- 子节点\n    - 跳过层级',
            'needs_review': True,
        }

        def handler(request):
            return httpx.Response(200, json={
                'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(invalid)}}],
            })

        with patch('src.ai_outline.OutlineProvider',
                   side_effect=lambda config: OutlineProvider(config, transport=httpx.MockTransport(handler))):
            response = await self.request(self.body)
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()['error'], 'INVALID_RESPONSE')


if __name__ == '__main__':
    unittest.main()
