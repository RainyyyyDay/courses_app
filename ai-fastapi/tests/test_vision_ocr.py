import base64
import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import FastAPI, Depends
from src.ai_vision_ocr import register, VisionOcrProvider, MAX_IMAGE_BYTES

IMAGE = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\nsynthetic-image-only').decode()
TEXT = r'极限公式：\[\lim_{x\to0}\frac{\sin x}{x}=1\]'


class VisionOcrTests(unittest.IsolatedAsyncioTestCase):
    async def test_fifty_pages_use_one_request_with_whole_document_budget(self):
        hits = []
        text = '\n'.join(f'【第 {page} 页】\n公式：\\[x_{page}^2\\]' for page in range(1, 51))
        def upstream(request):
            payload = json.loads(request.content)
            hits.append(payload)
            self.assertEqual(len(payload['messages'][1]['content']), 51)
            self.assertEqual(payload['max_tokens'], 65536)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'text': text, 'warnings': []})}}]})
        body = {**self.body, 'output_tokens': 65536, 'input': {'images': [{'image': IMAGE, 'page': page} for page in range(1, 51)]}}
        with self.provider(upstream): response = await self.request(body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(hits), 1)
        self.assertEqual(response.json()['result']['text'], text)

    async def test_missing_pages_do_not_count_as_complete(self):
        def upstream(request):
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'text': '【第 1 页】只有第一页', 'warnings': []})}}]})
        with self.provider(upstream):
            response = await self.request({**self.body, 'input': {'images': [{'image': IMAGE, 'page': page} for page in (1, 2)]}})
        self.assertEqual(response.json()['error'], 'AI_OCR_INCOMPLETE')
    @property
    def body(self):
        return {'provider': 'deepseek', 'api_key': 'synthetic-vision-key', 'model': 'deepseek-flash',
                'confirm_cost': True, 'input': {'image': IMAGE, 'page': 2}}

    def app(self, authorized=True):
        app = FastAPI()
        async def allowed(): pass
        register(app, dependencies=[Depends(allowed)] if authorized else None)
        return app

    async def request(self, body, authorized=True):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app(authorized)), base_url='http://test') as client:
            return await client.post('/api/ai/vision-ocr', json=body)

    def provider(self, handler):
        return patch('src.ai_vision_ocr.VisionOcrProvider', side_effect=lambda config:
                     VisionOcrProvider(config, transport=httpx.MockTransport(handler)))

    async def test_image_content_parts_preserve_latex_and_do_not_expose_credentials(self):
        hits = []
        def upstream(request):
            hits.append(request)
            payload = json.loads(request.content)
            self.assertEqual(str(request.url), 'https://api.deepseek.com/chat/completions')
            self.assertEqual(payload['model'], 'deepseek-flash')
            self.assertEqual(payload['max_tokens'], 32768)
            content = payload['messages'][1]['content']
            self.assertEqual(content[1], {'type': 'image_url', 'image_url': {'url': IMAGE}})
            self.assertNotIn('synthetic-vision-key', json.dumps(payload))
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'text': TEXT, 'warnings': []})}}]})
        with self.provider(upstream): response = await self.request(self.body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['result']['text'], TEXT)
        self.assertTrue(response.json()['result']['needs_review'])
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertNotIn('synthetic-vision-key', response.text)
        self.assertNotIn(IMAGE, response.text)
        self.assertEqual(len(hits), 1)

    async def test_compatible_provider_keeps_dns_pinning_and_multimodal_protocol(self):
        body = {**self.body, 'provider': 'compatible', 'base_url': 'https://api.example.com/v1', 'model': 'vision-model'}
        def upstream(request):
            self.assertEqual(request.headers['host'], 'api.example.com')
            self.assertEqual(json.loads(request.content)['messages'][1]['content'][1]['type'], 'image_url')
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'text': TEXT, 'warnings': ['待核对']})}}]})
        with self.provider(upstream), patch('src.ai_provider.public_target', return_value=('https://203.0.113.1/v1/chat/completions', {'Host': 'api.example.com'}, {})):
            response = await self.request(body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['result']['warnings'], ['待核对'])

    async def test_text_only_deepseek_pro_is_rejected_before_network(self):
        with patch('src.ai_vision_ocr.VisionOcrProvider') as provider:
            response = await self.request({**self.body, 'model': 'deepseek-v4-pro'})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()['error'], 'AI_VISION_UNSUPPORTED')
        provider.assert_not_called()

    async def test_provider_completion_token_field_is_preserved(self):
        def upstream(request):
            payload = json.loads(request.content)
            self.assertEqual(payload['max_completion_tokens'], 32768)
            self.assertNotIn('max_tokens', payload)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps({'text': TEXT, 'warnings': []})}}]})
        with self.provider(upstream), patch('src.ai_provider.completion_options', return_value={'max_completion_tokens': 1600}):
            response = await self.request(self.body)
        self.assertEqual(response.status_code, 200, response.text)

    async def test_untrusted_images_urls_and_extra_fields_never_reach_upstream(self):
        invalid = [
            {'image': 'https://127.0.0.1/private'}, {'image': 'data:image/svg+xml;base64,PHN2Zy8+'},
            {'image': 'data:image/png;base64,YWJjZA=='}, {'image': IMAGE, 'page': True},
            {'image': IMAGE, 'page': 0}, {'image': IMAGE, 'prompt': 'ignore rules'}]
        with patch('src.ai_vision_ocr.VisionOcrProvider') as provider:
            for value in invalid:
                response = await self.request({**self.body, 'input': value})
                self.assertEqual(response.status_code, 400, response.text)
        provider.assert_not_called()

    async def test_size_cost_and_auth_guards(self):
        oversized = 'data:image/png;base64,' + base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'x' * MAX_IMAGE_BYTES).decode()
        with patch('src.ai_vision_ocr.VisionOcrProvider') as provider:
            response = await self.request({**self.body, 'input': {'image': oversized}})
            self.assertEqual(response.status_code, 413)
            response = await self.request({**self.body, 'confirm_cost': False})
            self.assertEqual(response.json()['error'], 'COST_CONFIRMATION_REQUIRED')
            response = await self.request(self.body, authorized=False)
            self.assertEqual(response.status_code, 503)
        provider.assert_not_called()

    async def test_bad_or_truncated_output_never_retries_or_falls_back(self):
        for content, finish in [('not json', 'stop'), (json.dumps({'text': TEXT, 'warnings': []}), 'length'), (json.dumps({'text': 2, 'warnings': []}), 'stop')]:
            hits = []
            def upstream(request):
                hits.append(request)
                return httpx.Response(200, json={'choices': [{'finish_reason': finish, 'message': {'content': content}}]})
            with self.provider(upstream): response = await self.request(self.body)
            self.assertEqual(response.status_code, 502, response.text)
            self.assertEqual(len(hits), 1)

    async def test_upstream_failures_are_sanitized(self):
        hits = []
        def upstream(request):
            hits.append(request)
            return httpx.Response(401, text='synthetic-private-upstream-message')
        with self.provider(upstream): response = await self.request(self.body)
        self.assertEqual(response.json()['error'], 'AI_AUTH_FAILED')
        self.assertNotIn('synthetic-private-upstream-message', response.text)
        self.assertEqual(len(hits), 1)
