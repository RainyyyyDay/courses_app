import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import Depends, FastAPI

from src.ai_outline import OutlineProvider, OutlineDraftProvider, register


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

    async def test_accepts_fenced_json_and_equivalent_markdown_lists(self):
        for provider in ('deepseek', 'compatible'):
            for outline in ('* 函数\n    * 极限\n        * 定义',
                            '• 函数\n\t+ 极限\n\t\t- 定义'):
                result = {'title': '函数复习', 'outline': outline, 'needs_review': True}

                def handler(request):
                    return httpx.Response(200, json={'choices': [{
                        'finish_reason': 'stop',
                        'message': {'content': '```json\n' + json.dumps(result) + '\n```'},
                    }]})

                body = {**self.body, 'provider': provider}
                if provider == 'compatible':
                    body.update(base_url='https://api.example.com/v1', model='example-model')
                with patch('src.ai_outline.OutlineProvider', side_effect=lambda config:
                           OutlineProvider(config, transport=httpx.MockTransport(handler))), \
                        patch('src.ai_provider.public_target', return_value=(
                            'https://api.example.com/v1/chat/completions', {}, {})):
                    response = await self.request(body)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.json()['result']['outline'],
                                 '- 函数\n  - 极限\n    - 定义')
                self.assertNotIn('synthetic-outline-key', response.text)

    async def test_rejects_truncated_and_unstructured_output(self):
        for content, finish in (('说明：这是一份大纲', 'stop'),
                                ('{"title":"未完成', 'length')):
            def handler(request):
                return httpx.Response(200, json={'choices': [{
                    'finish_reason': finish, 'message': {'content': content}}]})
            with patch('src.ai_outline.OutlineProvider', side_effect=lambda config:
                       OutlineProvider(config, transport=httpx.MockTransport(handler))):
                response = await self.request(self.body)
            self.assertEqual(response.status_code, 502)


    async def test_draft_does_not_require_mindmap_schema_or_layout(self):
        # English source often needs longer nodes and more than three levels.
        outline = '# Writing\n- ' + 'Important source term ' * 6 + '\n  - Step\n    - Detail\n      - Example'
        def handler(request):
            self.assertNotIn('synthetic-outline-key', request.content.decode())
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop',
                'message': {'content': json.dumps({'outline': outline})}}]})
        with patch('src.ai_outline.OutlineDraftProvider', side_effect=lambda config:
                   OutlineDraftProvider(config, transport=httpx.MockTransport(handler))):
            response = await self.request({**self.body, 'purpose': 'outline_draft'})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['result'], {
            'title': '函数复习', 'outline': outline, 'needs_review': True})

    async def test_draft_reports_specific_errors_and_never_returns_private_response(self):
        for value, code in [({}, 'OUTLINE_FORMAT_INVALID'),
                            ({'outline': []}, 'OUTLINE_FORMAT_INVALID'),
                            ({'outline': ''}, 'OUTLINE_EMPTY'),
                            ({'outline': '- x\n' * 161}, 'OUTLINE_TOO_LONG')]:
            def handler(request):
                return httpx.Response(200, json={'choices': [{'finish_reason': 'stop',
                    'message': {'content': json.dumps(value)}}]})
            with patch('src.ai_outline.OutlineDraftProvider', side_effect=lambda config:
                       OutlineDraftProvider(config, transport=httpx.MockTransport(handler))):
                response = await self.request({**self.body, 'purpose': 'outline_draft'})
            self.assertEqual((response.status_code, response.json()), (502, {'error': code}))

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
