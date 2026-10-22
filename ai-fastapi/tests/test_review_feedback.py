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
from src.ai_review_feedback import PATH, FeedbackProvider, normalize, parse_input, register
from src.ai_mistake import AIError, Config
from test_app import local_only, frontend, FRONTEND


def feedback(answer='不会'):
    return dict(judgment='incorrect', summary='尚未完成解释，请核对概念及例子。',
                errors=[dict(quote=answer, explanation='没有解释概念关系。', correction='先说明关系，再给出数值例子。')],
                reference_answer='例如 1+2=3，所以 3-1=2。', reference_check='参考要点仍需人工核实。',
                steps=['从等式两边同时减去相同的数。'], suggestions=['自行举一个例子。'], needs_review=True)


def response(value, status=200):
    return httpx.Response(status, json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(value)}}]})


class FeedbackTests(unittest.IsolatedAsyncioTestCase):
    async def request(self, changes=None, *, auth=True, result=None, status=200):
        body=dict(provider='deepseek', api_key='synthetic-feedback-key', model='deepseek-flash', confirm_cost=True,
                  input=dict(mode_id='self_explain', question='解释加减关系', student_answer='不会', reference='加减互逆', rubric='概念和例子'))
        body.update(changes or {})
        app=FastAPI()
        async def allow(): pass
        register(app, dependencies=[Depends(allow)] if auth else None)
        def handler(request):
            self.assertEqual(str(request.url), 'https://api.deepseek.com/chat/completions')
            prompt=json.loads(request.content)['messages'][0]['content']
            self.assertIn('不输出grade', prompt)
            self.assertIn('不盲从', prompt)
            return response(result if result is not None else feedback(), status)
        with patch('src.ai_review_feedback.FeedbackProvider', side_effect=lambda c:FeedbackProvider(c, transport=httpx.MockTransport(handler))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                r=await client.post(PATH, json=body)
        self.assertNotIn('synthetic-feedback-key', r.text)
        return r

    async def test_modes_mock_and_read_only_schema(self):
        for mode in ('standard','self_explain','contrast','cloze','choice_reproduction','retry'):
            r=await self.request({'input':dict(mode_id=mode,question='题面',student_answer='不会')})
            self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(r.headers['cache-control'],'no-store')
            self.assertTrue(r.json()['feedback']['needs_review'])
        r=await self.request({'provider':'mock','api_key':''})
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['feedback']['judgment'],'uncertain')
        self.assertEqual(r.json()['feedback']['errors'],[])
        data=feedback();data['grade']=4
        self.assertNotIn('grade',normalize(data,{'student_answer':'不会'}))

    async def test_auth_validation_and_no_silent_fallback(self):
        self.assertEqual((await self.request(auth=False)).status_code,503)
        for change in ({'confirm_cost':False},{'api_key':''},{'provider':'other'},{'model':'unknown'},{'url':'https://example.com'}):
            self.assertEqual((await self.request(change)).status_code,400)
        self.assertEqual((await self.request(status=401)).json()['error'],'AI_AUTH_FAILED')
        invalid=feedback();invalid['errors'][0]['quote']='不是学生写的'
        self.assertEqual((await self.request(result=invalid)).json()['error'],'INVALID_RESPONSE')
        for data in ({'mode_id':'reading','question':'题','student_answer':'答'}, {'mode_id':'standard','question':'题','student_answer':''}, {'mode_id':'standard','question':'题','student_answer':'a'*4001}):
            with self.assertRaises(AIError):parse_input(data)
        for change in ({'needs_review':False},{'summary':''},{'steps':['x'*601]},{'errors':[{}]}):
            self.assertIsNone(normalize({**feedback(),**change},{'student_answer':'不会'}))
        app=FastAPI();register(app)
        with self.assertRaises(ValueError):register(app)


class FeedbackBrowser(unittest.TestCase):
    def test_feedback_in_real_review_pages(self):
        app=FastAPI()
        with patch('src.ai_review_feedback.Config',return_value=Config(rate_max=100)):
            register(app,dependencies=[Depends(local_only)])
        app.add_api_route('/',frontend,methods=['GET'],response_class=HTMLResponse,dependencies=[Depends(local_only)])
        app.mount('/',StaticFiles(directory=FRONTEND))
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
        base='http://127.0.0.1:'+str(listener.getsockname()[1])
        server=uvicorn.Server(uvicorn.Config(app,access_log=False,log_level='error'))
        thread=threading.Thread(target=server.run,kwargs={'sockets':[listener]},daemon=True);thread.start()
        async def handler(request):
            data=json.loads(json.loads(request.content)['messages'][1]['content'])
            if 'FAIL' in data['question']:return response({},401)
            await asyncio.sleep(.1)
            result=feedback(data['student_answer'][:100])
            result['summary']='<img src=x onerror="window.feedbackInjected=true">参考意见'
            return response(result)
        try:
            with patch('src.ai_review_feedback.FeedbackProvider',side_effect=lambda c:FeedbackProvider(c,transport=httpx.MockTransport(handler))):
                r=subprocess.run(['node','--test','--test-name-pattern=optional AI feedback','tests/review-feedback.cjs'],cwd=Path(__file__).resolve().parents[2],env={**os.environ,'COURSES_TEST_AI_BASE':base},capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=110)
                self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        finally:server.should_exit=True;thread.join(timeout=10);listener.close()
