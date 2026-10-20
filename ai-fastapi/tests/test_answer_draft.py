"""Fake upstream only. Draft generation never writes DB or adopts an answer."""
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import threading
import unittest
from unittest.mock import patch

import httpx
import uvicorn
from fastapi import Depends, FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from src.ai_answer_draft import register, AnswerProvider, normalize_draft
from src.ai_mistake import Config
from test_app import local_only, frontend, FRONTEND

INPUT={'question':'1+1=?','question_format':'open','options':[],'choice_type':'single','existing_answer':'','existing_explanation':''}
BODY={'provider':'deepseek','api_key':'synthetic-answer-key','model':'deepseek-flash','confirm_cost':True,'input':INPUT}
DRAFT={'answer':'2','explanation':'把一个和另一个合并，共两个。 <img src=x onerror=alert(1)>',
       'choice_answer':[],'caveats':['AI 草稿，请人工核实。'],'needs_more_information':False}

def response(value=None):
    return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(DRAFT if value is None else value)}}]})


class DraftTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.app=FastAPI()
        async def allowed():pass  # Test double, not production authentication.
        register(self.app,dependencies=[Depends(allowed)])

    async def request(self,body=None,handler=None,app=None):
        with patch('src.ai_answer_draft.AnswerProvider',side_effect=lambda config:AnswerProvider(config,transport=httpx.MockTransport(handler or (lambda request:response())))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app or self.app),base_url='http://test') as client:
                return await client.post('/api/ai/answer-draft',json=BODY if body is None else body)

    async def test_denied_without_host_auth_and_duplicate_safe(self):
        app=FastAPI();register(app)
        with patch('src.ai_answer_draft.AnswerProvider',side_effect=AssertionError('no call')):
            self.assertEqual((await self.request(app=app)).status_code,503)
        with self.assertRaises(ValueError):register(app)

    async def test_fixed_protocol_and_bounded_whitelisted_draft(self):
        hits=[]
        def handler(request):
            hits.append(1)
            self.assertEqual(str(request.url),'https://api.deepseek.com/chat/completions')
            data=json.loads(request.content)
            self.assertIn('参考答案草稿助手',data['messages'][0]['content'])
            self.assertNotIn('possible_causes',data['messages'][0]['content'])
            self.assertEqual(json.loads(data['messages'][1]['content']),INPUT)
            return response({**DRAFT,'api_key':'do-not-return','grade':3})
        r=await self.request(handler=handler)
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['draft'],{**DRAFT,'needs_review':True})
        self.assertEqual(r.headers['cache-control'],'no-store')
        self.assertNotIn('do-not-return',r.text);self.assertNotIn('synthetic-answer-key',r.text)
        self.assertEqual(hits,[1])

    async def test_mock_explicitly_cannot_supply_a_real_answer(self):
        with patch.object(AnswerProvider,'complete_json',side_effect=AssertionError('no call')):
            r=await self.request({'provider':'mock','input':INPUT})
        self.assertEqual(r.status_code,200)
        self.assertEqual(r.json()['draft']['answer'],'')
        self.assertTrue(r.json()['draft']['needs_more_information'])
        self.assertIn('Mock',r.json()['draft']['explanation'])

    async def test_invalid_input_and_cost_never_call(self):
        for body in [{**BODY,'confirm_cost':False},{**BODY,'api_key':''},{**BODY,'base_url':'http://evil.invalid'},
                     {**BODY,'model':'arbitrary'},{**BODY,'input':{**INPUT,'question':''}},
                     {**BODY,'input':{**INPUT,'question_format':'choice','options':[]}},
                     {**BODY,'input':{**INPUT,'question':'x'*4001}}]:
            with patch('src.ai_answer_draft.AnswerProvider',side_effect=AssertionError('no call')):
                self.assertEqual((await self.request(body)).status_code,400)

    async def test_choice_candidates_and_uncertainty_validated(self):
        data={**INPUT,'question_format':'choice','options':[{'id':'A','text':'1'},{'id':'B','text':'2'}]}
        self.assertIsNone(normalize_draft(DRAFT,data))
        self.assertIsNone(normalize_draft({**DRAFT,'choice_answer':['Z']},data))
        self.assertIsNone(normalize_draft({**DRAFT,'choice_answer':['A','B']},data))
        self.assertIsNotNone(normalize_draft({**DRAFT,'choice_answer':['B']},data))
        self.assertIsNotNone(normalize_draft({**DRAFT,'answer':'','needs_more_information':True},INPUT))
        self.assertIsNone(normalize_draft({**DRAFT,'answer':''},INPUT))
        r=await self.request(handler=lambda request:response({'wrong':'invalid'}))
        self.assertEqual((r.status_code,r.json()),(502,{'error':'INVALID_RESPONSE'}))

    async def test_errors_and_redirects_no_retry_or_mock_fallback(self):
        for status,code in [(401,'AI_AUTH_FAILED'),(402,'AI_BALANCE_UNAVAILABLE'),(302,'AI_UNAVAILABLE')]:
            hits=[]
            def handler(request):
                hits.append(1);return httpx.Response(status,text='private fake error',headers={'location':'https://evil.invalid'})
            r=await self.request(handler=handler)
            self.assertEqual(r.json(),{'error':code});self.assertEqual(hits,[1]);self.assertNotIn('private',r.text)

    async def test_per_app_rate_limit(self):
        for i in range(11):
            r=await self.request({'provider':'mock','input':INPUT})
            self.assertEqual(r.status_code,200 if i<10 else 429)
        self.assertIn('retry-after',r.headers)


class BrowserDraftTests(unittest.TestCase):
    def test_normal_create_edit_choice_and_draft_safety(self):
        app=FastAPI()
        # Many explicit scenarios in two viewports; do not exhaust the production
        # quota in a single browser test. The real limit is tested separately.
        with patch('src.ai_answer_draft.Config',return_value=Config(rate_max=100)):
            register(app,dependencies=[Depends(local_only)])
        app.add_api_route('/',frontend,methods=['GET'],response_class=HTMLResponse,dependencies=[Depends(local_only)])
        app.mount('/',StaticFiles(directory=FRONTEND))
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
        base='http://127.0.0.1:'+str(listener.getsockname()[1])
        server=uvicorn.Server(uvicorn.Config(app,access_log=False,log_level='error'))
        thread=threading.Thread(target=server.run,kwargs={'sockets':[listener]},daemon=True);thread.start()
        async def handler(request):
            data=json.loads(json.loads(request.content)['messages'][1]['content'])
            if data['question']=='FAIL':return httpx.Response(401,text='private fake error')
            await asyncio.sleep(0.1)
            ids=(['A','C'] if data['choice_type']=='multiple' else ['B']) if data['question_format']=='choice' else []
            return response({**DRAFT,'choice_answer':ids})
        try:
            with patch('src.ai_answer_draft.AnswerProvider',side_effect=lambda config:AnswerProvider(config,transport=httpx.MockTransport(handler))):
                r=subprocess.run(['node','--test','--test-name-pattern=answer draft editor','tests/mistake-answer-ai.cjs'],
                    cwd=Path(__file__).resolve().parents[2],env={**os.environ,'COURSES_TEST_AI_BASE':base},
                    capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=100)
                self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        finally:
            server.should_exit=True;thread.join(timeout=10);listener.close()
        self.assertFalse(thread.is_alive())
