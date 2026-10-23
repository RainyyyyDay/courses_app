import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import Depends, FastAPI

from src.ai_creation_review import register


class CreationReviewTests(unittest.IsolatedAsyncioTestCase):
    def app(self):
        app = FastAPI()
        async def allowed():
            pass
        register(app, dependencies=[Depends(allowed)])
        return app

    async def request(self, body):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app()), base_url='http://test') as client:
            return await client.post('/api/ai/review-mode-advice', json=body)

    async def test_mock_accepts_all_three_sources_and_never_returns_standard(self):
        for kind in ('material', 'note', 'mistake'):
            response = await self.request({
                'provider': 'mock',
                'input': {'kind': kind, 'title': '虚构测试', 'content': '已读取的正文和 OCR 文字',
                          'goal': 'remember', 'extra_context': '我容易混淆这些细节。',
                          'mistake_type': 'knowledge' if kind == 'mistake' else ''}
            })
            self.assertEqual(response.status_code, 200)
            result = response.json()['result']
            self.assertEqual(result['review_method'], 'cloze')
            self.assertNotEqual(result['review_method'], 'standard')
            self.assertEqual(response.headers['cache-control'], 'no-store')

    async def test_invalid_or_missing_content_is_denied(self):
        for value in (
            {'kind': 'note', 'title': '标题', 'content': ''},
            {'kind': 'assessment', 'title': '标题', 'content': '正文'},
            {'kind': 'mistake', 'title': '标题'},
            {'kind': 'note', 'title': '标题', 'content': '正文', 'goal': 'unknown'},
            {'kind': 'note', 'title': '标题', 'content': '正文', 'mistake_type': 'knowledge'},
            {'kind': 'mistake', 'title': '标题', 'content': '正文', 'mistake_type': 'unknown'},
            {'kind': 'note', 'title': '标题', 'content': '正文', 'extra_context': 'a' * 2001},
        ):
            response = await self.request({'provider': 'mock', 'input': value})
            self.assertEqual(response.status_code, 400)

    async def test_provider_is_limited_to_five_non_standard_modes(self):
        body = {
            'provider': 'deepseek',
            'api_key': 'synthetic-creation-key',
            'model': 'deepseek-flash',
            'confirm_cost': True,
            'input': {'kind': 'mistake', 'title': '题目', 'content': '题目与答案文字'},
        }
        valid = {'review_method': 'self_explain', 'reason': '先讲解再核对答案。', 'needs_review': True}
        def handler(request):
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(valid)}}]})
        from src.ai_creation_review import CreationReviewProvider
        with patch('src.ai_creation_review.CreationReviewProvider',
                   side_effect=lambda config: CreationReviewProvider(config, transport=httpx.MockTransport(handler))):
            response = await self.request(body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['result'], valid)
        self.assertNotIn('synthetic-creation-key', response.text)

        invalid = {**valid, 'review_method': 'standard'}
        def invalid_handler(request):
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(invalid)}}]})
        with patch('src.ai_creation_review.CreationReviewProvider',
                   side_effect=lambda config: CreationReviewProvider(config, transport=httpx.MockTransport(invalid_handler))):
            response = await self.request(body)
        self.assertEqual(response.status_code, 502)


if __name__ == '__main__':
    unittest.main()
