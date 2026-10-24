"""Transient official-Key tests: synthetic keys, fake upstream only, no database."""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import unittest
from unittest.mock import patch
from analysis_fixtures import result as analysis_result

import httpx
import uvicorn
from fastapi import Depends, FastAPI

from src.ai_deepseek_test import PATH, register
from src.ai_mistake import Config, DeepSeekProvider, MockProvider, register as register_mock
from test_app import app as local_app, local_only, frontend, FRONTEND

FAKE = 'synthetic-test-key-not-real'
BODY = {'api_key': FAKE, 'model': 'deepseek-flash', 'action': 'connection', 'confirm_cost': True}
RESULT = {**analysis_result('retry'), 'reason': '虚构上游建议 <img src=x onerror=alert(1)>'}


def response(result=None):
    return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {
        'content': json.dumps(RESULT if result is None else result)}}]})


class TransientTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, body=None, handler=None, app=None, **kwargs):
        app = app or local_app
        handler = handler or (lambda request: response())
        with patch('src.ai_deepseek_test.DeepSeekProvider', side_effect=lambda config: DeepSeekProvider(
                config, transport=httpx.MockTransport(handler))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 1)),
                                         base_url='http://localhost:3002') as client:
                return await client.post(PATH, json=BODY if body is None else body, **kwargs)

    async def asyncSetUp(self):
        self.app = FastAPI()
        async def test_permission():
            pass  # Test double only.
        register(self.app, dependencies=[Depends(test_permission)])

    async def test_explicit_registration_defaults_to_denial(self):
        app = FastAPI()
        register(app)
        with patch('src.ai_deepseek_test.DeepSeekProvider', side_effect=AssertionError('no upstream')):
            r = await self.request(app=app)
        self.assertEqual(r.status_code, 503)
        self.assertNotIn(FAKE, r.text)
        with self.assertRaises(ValueError):
            register(app)

    async def test_fixed_official_protocol_and_connection(self):
        hits = []
        def handler(request):
            hits.append(request)
            self.assertEqual(str(request.url), 'https://api.deepseek.com/chat/completions')
            self.assertEqual(request.headers['authorization'], 'Bearer '+FAKE)
            data = json.loads(request.content)
            self.assertEqual(data['model'], 'deepseek-flash')
            self.assertEqual(data['max_tokens'], 1600)
            self.assertNotIn(FAKE, request.content.decode())
            return response()
        r = await self.request(handler=handler, app=self.app)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['ok'])
        self.assertNotIn('result', r.json())
        self.assertNotIn(FAKE, r.text)
        self.assertEqual(r.headers['cache-control'], 'no-store')
        self.assertEqual(len(hits), 1)

    async def test_classify_and_per_request_key_isolation(self):
        seen = []
        def handler(request):
            seen.append(request.headers['authorization'])
            self.assertEqual(json.loads(json.loads(request.content)['messages'][1]['content'])['question'], '自填题目')
            return response()
        for key in [FAKE, FAKE+'-other']:
            r = await self.request({**BODY, 'api_key': key, 'action': 'classify', 'model': 'deepseek-v4-pro',
                                    'input': {'question': '自填题目', 'student_answer': '3', 'error_type': 'careless'}},
                                   handler=handler, app=self.app)
            expected = {**RESULT, 'analysis': {**RESULT['analysis'], 'material_requirements': ['使用原题重新作答；核对前需有可靠参考答案或要点。']}}
            self.assertEqual(r.json()['result'], expected)
            self.assertNotIn(key, r.text)
        self.assertEqual(seen, ['Bearer '+FAKE, 'Bearer '+FAKE+'-other'])

    async def test_invalid_input_cost_key_address_and_model_never_call(self):
        invalid = [{**BODY, 'confirm_cost': False}, {**BODY, 'api_key': ''},
                   {**BODY, 'api_key': FAKE+'\r\nx: y'}, {**BODY, 'api_key': '中文'},
                   {**BODY, 'base_url': 'http://127.0.0.1'}, {**BODY, 'model': 'arbitrary'},
                   {**BODY, 'action': 'classify', 'input': {}}, {**BODY, 'action': 'classify',
                    'input': {'question': 'x', 'student_answer': 'y', 'error_type': 'x', 'user_id': 'forged'}}]
        for body in invalid:
            with self.subTest(body_fields=list(body)):
                def forbidden(request):
                    raise AssertionError('must not call')
                r = await self.request(body, handler=forbidden, app=self.app)
                self.assertEqual(r.status_code, 400)
                self.assertNotIn(FAKE, r.text)

    async def test_upstream_errors_are_sanitized_without_retry_or_mock(self):
        for status, expected in [(401, 'AI_AUTH_FAILED'), (402, 'AI_BALANCE_UNAVAILABLE'),
                                 (429, 'AI_UPSTREAM_RATE_LIMITED'), (500, 'AI_UNAVAILABLE'),
                                 (302, 'AI_UNAVAILABLE')]:
            hits = []
            def handler(request):
                hits.append(1)
                return httpx.Response(status, text=FAKE, headers={'location': 'https://evil.invalid'})
            with patch.object(MockProvider, 'classify', side_effect=AssertionError('no fallback')):
                r = await self.request(handler=handler, app=self.app)
            self.assertEqual(r.json(), {'error': expected, 'upstream_status': status})
            self.assertNotIn(FAKE, r.text)
            self.assertEqual(len(hits), 1)

    async def test_connection_failures_report_specific_safe_reasons(self):
        cases = [
            (200, {'choices': [{'finish_reason': 'length', 'message': {'content': '{'}}]}, 'AI_OUTPUT_LIMIT'),
            (200, {'choices': [{'finish_reason': 'stop', 'message': {'content': 'not json'}}]}, 'AI_INVALID_JSON'),
            (200, {'choices': []}, 'AI_RESPONSE_FORMAT'),
            (400, {'error': {'code': 'model_not_found', 'message': FAKE}}, 'AI_MODEL_NOT_FOUND'),
            (403, {'error': {'message': FAKE}}, 'AI_MODEL_PERMISSION'),
        ]
        for status, payload, expected in cases:
            r = await self.request(handler=lambda request: httpx.Response(status, json=payload), app=self.app)
            self.assertEqual(r.json()['error'], expected, r.text)
            self.assertNotIn(FAKE, r.text)
        def disconnected(request):
            raise httpx.ConnectError(FAKE, request=request)
        r = await self.request(handler=disconnected, app=self.app)
        self.assertEqual(r.json(), {'error': 'AI_CONNECTION_FAILED'})

    async def test_invalid_model_result_not_success(self):
        r = await self.request(handler=lambda request: response({'wrong': FAKE}), app=self.app)
        self.assertEqual((r.status_code, r.json()), (502, {'error': 'INVALID_RESPONSE'}))

    async def test_body_limits_json_and_content_type(self):
        with patch('src.ai_deepseek_test.DeepSeekProvider', side_effect=AssertionError('no upstream')):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test') as client:
                for body, media, status, code in [(b'{', 'application/json', 400, 'INVALID_JSON'),
                                                  (b'x'*16385, 'application/json', 413, 'BODY_TOO_LARGE'),
                                                  (b'{}', 'text/plain', 415, 'JSON_REQUIRED')]:
                    r = await client.post(PATH, content=body, headers={'Content-Type': media})
                    self.assertEqual((r.status_code, r.json()), (status, {'error': code}))

    async def test_timeout_has_no_retry_and_no_retained_capacity(self):
        hits = []
        async def slow(request):
            hits.append(1)
            await asyncio.sleep(10)
            return response()
        def short_config(**kwargs):
            return Config(**kwargs, timeout_ms=20)
        with patch('src.ai_deepseek_test.Config', side_effect=short_config):
            r = await self.request(handler=slow, app=self.app)
        self.assertEqual((r.status_code, r.json()), (504, {'error': 'AI_TIMEOUT'}))
        self.assertEqual(len(hits), 1)
        r = await self.request(app=self.app)
        self.assertEqual(r.status_code, 200)

    async def test_shared_rate_limit_across_keys(self):
        for i in range(11):
            r = await self.request({**BODY, 'api_key': FAKE+str(i)}, app=self.app)
            self.assertEqual(r.status_code, 200 if i < 10 else 429)
        self.assertIn('retry-after', r.headers)

    async def test_shared_concurrency_limit_across_keys(self):
        entered, release = asyncio.Event(), asyncio.Event()
        count = 0
        async def handler(request):
            nonlocal count
            count += 1
            if count == 2:
                entered.set()
            await release.wait()
            return response()
        with patch('src.ai_deepseek_test.DeepSeekProvider', side_effect=lambda config: DeepSeekProvider(
                config, transport=httpx.MockTransport(handler))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url='http://test') as client:
                tasks = [asyncio.create_task(client.post(PATH, json={**BODY, 'api_key': FAKE+str(i)})) for i in range(2)]
                try:
                    await asyncio.wait_for(entered.wait(), 3)
                    r = await client.post(PATH, json={**BODY, 'api_key': FAKE+'third'})
                    self.assertEqual((r.status_code, r.json()), (503, {'error': 'AI_BUSY'}))
                finally:
                    release.set()
                    results = await asyncio.gather(*tasks)
                self.assertTrue(all(r.status_code == 200 for r in results))

    async def test_local_only_and_original_mock_unaffected(self):
        for headers in [{'Origin': 'http://evil.invalid'}, {'X-Forwarded-For': '1.2.3.4'}, {'Host': 'evil.invalid'}]:
            r = await self.request(headers=headers)
            self.assertEqual(r.status_code, 403)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=local_app, client=('127.0.0.1', 1)),
                                    base_url='http://localhost:3002') as client:
            r = await client.post('/api/ai/classify', json={'question': 'x', 'student_answer': 'y', 'error_type': 'careless'})
            self.assertEqual(r.headers['x-ai-provider'], 'mock')
            page = await client.get('/ai-test')
            self.assertEqual(page.status_code, 200)
            self.assertIn("frame-ancestors 'none'", page.headers['content-security-policy'])
            self.assertEqual(page.headers['cache-control'], 'no-store')


class BrowserTest(unittest.TestCase):
    def test_website_advice_confirmation_and_real_review_flow(self):
        from fastapi.responses import HTMLResponse
        from fastapi.staticfiles import StaticFiles
        # Separate per-app rate buckets: tests must not consume one another's quota.
        website_app = FastAPI()
        register_mock(website_app, dependencies=[Depends(local_only)], config=Config())
        register(website_app, dependencies=[Depends(local_only)])
        website_app.add_api_route('/', frontend, methods=['GET'], response_class=HTMLResponse,
                                  dependencies=[Depends(local_only)])
        website_app.mount('/', StaticFiles(directory=FRONTEND))
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        base = 'http://127.0.0.1:'+str(listener.getsockname()[1])
        server = uvicorn.Server(uvicorn.Config(website_app, access_log=False, log_level='error'))
        thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
        thread.start()
        hits = []
        def handler(request):
            hits.append(request.headers['authorization'])
            if request.headers['authorization'] == 'Bearer synthetic-invalid':
                return httpx.Response(401, text='private fake upstream error')
            return response({**RESULT, 'review_method': 'self_explain'})
        try:
            with patch('src.ai_deepseek_test.DeepSeekProvider', side_effect=lambda config: DeepSeekProvider(
                    config, transport=httpx.MockTransport(handler))):
                result = subprocess.run(['node', '--test', '--test-name-pattern=website temporary DeepSeek',
                                         'tests/mistake-ai-byok.cjs'], cwd=Path(__file__).resolve().parents[2],
                                        env={**os.environ, 'COURSES_TEST_AI_BASE': base}, capture_output=True,
                                        text=True, encoding='utf-8', errors='replace', timeout=100)
                self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            self.assertEqual(hits, ['Bearer synthetic-website-key', 'Bearer synthetic-invalid',
                                    'Bearer synthetic-create-key', 'Bearer synthetic-website-key']*2)
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
        self.assertFalse(thread.is_alive())

    def test_real_browser_transient_key_and_no_automatic_requests(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        base = 'http://127.0.0.1:'+str(listener.getsockname()[1])
        server = uvicorn.Server(uvicorn.Config(local_app, access_log=False, log_level='error'))
        thread = threading.Thread(target=server.run, kwargs={'sockets': [listener]}, daemon=True)
        thread.start()
        script = r"""
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {runBrowser}=require(process.argv[2]+'/tests/browser-driver.cjs');
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
assert.ok(chrome,'Chrome/Edge required');
const initScript=`addEventListener('load',async()=>{
 const out=document.createElement('pre');out.id='regressionResult';
 const el=id=>document.getElementById(id),check=(v,m)=>{if(!v)throw Error(m);};
 const wait=async()=>{for(let i=0;i<300&&el('controls').disabled;i++)await new Promise(r=>setTimeout(r,20));check(!el('controls').disabled,'request finished');};
 try{
  check(el('status').textContent.includes('尚未'),'no request on load');
  check(!el('apiKey').value&&el('apiKey').type==='password','empty masked Key');
  const local=JSON.stringify(localStorage),session=JSON.stringify(sessionStorage);
  el('apiKey').value='synthetic-browser-key';
  el('testForm').dispatchEvent(new Event('submit',{cancelable:true}));
  check(!el('controls').disabled&&el('apiKey').value,'consent required');
  el('confirmCost').checked=true;
  el('testForm').requestSubmit(document.querySelector('button[value=connection]'));
  check(el('apiKey').value===''&&el('controls').disabled,'cleared immediately; double-click blocked');
  await wait();check(el('status').textContent.includes('成功'),'connection succeeds');
  el('apiKey').value='synthetic-browser-key';el('confirmCost').checked=true;
  el('testForm').requestSubmit(document.querySelector('button[value=classify]'));await wait();
  check(el('result').textContent.includes('retry')&&!el('result').querySelector('img'),'result rendered as text');
  check(!el('result').textContent.includes('synthetic-browser-key'),'no Key in output');
  check(JSON.stringify(localStorage)===local&&JSON.stringify(sessionStorage)===session,'storage unchanged');
  check(document.documentElement.scrollWidth<=innerWidth+1,'mobile fits viewport');
  el('clear').click();check(!el('result').textContent&&!el('apiKey').value,'clear works');
  el('apiKey').value='synthetic-invalid';el('confirmCost').checked=true;
  el('testForm').requestSubmit(document.querySelector('button[value=connection]'));await wait();
  check(el('status').textContent.includes('Key 无效')&&!el('apiKey').value,'safe error, no retained Key');
  out.textContent='passed';out.dataset.result='passed';
 }catch(e){out.textContent=e.stack;out.dataset.result='failed';}document.body.append(out);
});`;
(async()=>{for(const viewport of [[1280,960],[390,844]]){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'courses-deepseek-test-'));
 try{const html=await runBrowser({chrome,profile,url:process.argv[1]+'/ai-test',viewport,initScript,
 screenshot:path.join(os.tmpdir(),'courses-deepseek-test-'+viewport.join('x')+'.png')});
 const result=html.match(/<pre id="regressionResult"[^>]*>[\s\S]*?<\/pre>/)?.[0];
 assert.match(result||'',/data-result="passed"/,result||html.slice(-1000));
 }finally{fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}console.log('Transient Key desktop/mobile browser passed');})().catch(e=>{console.error(e);process.exitCode=1;});
"""
        hits = []
        def handler(request):
            hits.append(request)
            if request.headers['authorization'] == 'Bearer synthetic-invalid':
                return httpx.Response(401, text='private fake upstream error')
            return response()
        try:
            with patch('src.ai_deepseek_test.DeepSeekProvider', side_effect=lambda config: DeepSeekProvider(
                    config, transport=httpx.MockTransport(handler))):
                # Server socket is listening before Chrome starts; uvicorn starts in background.
                result = subprocess.run(['node', '-e', script, base, str(Path(__file__).resolve().parents[2])],
                                        capture_output=True, text=True, timeout=90)
                self.assertEqual(result.returncode, 0, result.stdout+result.stderr)
            self.assertEqual(len(hits), 6)  # Exactly three clicks per viewport; no automatic/repeated calls.
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
        self.assertFalse(thread.is_alive())
