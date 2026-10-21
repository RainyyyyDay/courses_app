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
from src.ai_mistake import Config
from src.ai_review_suggestion import register, ReviewProvider
from test_app import local_only, frontend, FRONTEND

INPUT={'kind':'note','title':'学习笔记','content':'中国首都是北京。','goal':'remember'}
RESULT={'review_method':'self_explain','reason':'用自己的话讲清材料要点，先手动准备参考要点。','needs_review':True}


class ResourceRoutes(unittest.IsolatedAsyncioTestCase):
    async def request(self, body, *, auth=True, status=200, result=RESULT):
        app=FastAPI()
        async def allowed():pass
        register(app,dependencies=[Depends(allowed)] if auth else None)
        def handler(request):
            value=json.loads(request.content)
            self.assertEqual(str(request.url),'https://api.deepseek.com/chat/completions')
            self.assertIn('资料和笔记',value['messages'][0]['content'])
            return httpx.Response(status,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(result)}}]})
        with patch('src.ai_review_suggestion.ReviewProvider',side_effect=lambda c:ReviewProvider(c,transport=httpx.MockTransport(handler))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                response=await client.post('/api/ai/review-suggestion',json=body)
        self.assertNotIn('synthetic-resource-key',response.text)
        return response

    async def test_mock_resource_needs_no_student_answer_and_has_six_modes(self):
        for kind in ('material','note'):
            response=await self.request({'provider':'mock','input':{**INPUT,'kind':kind}})
            self.assertEqual(response.status_code,200);self.assertEqual(response.json()['result']['review_method'],'cloze')
            self.assertIn('Mock',response.json()['result']['reason']);self.assertEqual(response.headers['cache-control'],'no-store')

    async def test_real_protocol_and_unsafe_input_denied(self):
        body={'provider':'deepseek','api_key':'synthetic-resource-key','model':'deepseek-flash','confirm_cost':True,'input':INPUT}
        self.assertEqual((await self.request(body)).json()['result'],RESULT)
        for invalid in ({**body,'confirm_cost':False},{**body,'api_key':''},{**body,'base_url':'http://evil.invalid'},
                        {**body,'input':{**INPUT,'content':''}},{**body,'input':{**INPUT,'kind':'mistake'}},
                        {**body,'input':{**INPUT,'content':'a'*4001}}):
            self.assertEqual((await self.request(invalid)).status_code,400)
        self.assertEqual((await self.request(body,status=401)).json()['error'],'AI_AUTH_FAILED')
        self.assertEqual((await self.request(body,result={**RESULT,'review_method':'choice_reproduction'})).status_code,502)

    async def test_missing_authorization_and_duplicate_denied(self):
        self.assertEqual((await self.request({'provider':'mock','input':INPUT},auth=False)).status_code,503)
        app=FastAPI();register(app)
        with self.assertRaises(ValueError):register(app)


class ResourceBrowser(unittest.TestCase):
    def test_resource_real_website_flow(self):
        app=FastAPI()
        with patch('src.ai_review_suggestion.Config',return_value=Config(rate_max=100)):
            register(app,dependencies=[Depends(local_only)])
        app.add_api_route('/',frontend,methods=['GET'],response_class=HTMLResponse,dependencies=[Depends(local_only)])
        app.mount('/',StaticFiles(directory=FRONTEND))
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
        base='http://127.0.0.1:'+str(listener.getsockname()[1]);server=uvicorn.Server(uvicorn.Config(app,access_log=False,log_level='error'))
        thread=threading.Thread(target=server.run,kwargs={'sockets':[listener]},daemon=True);thread.start()
        async def handler(request):
            data=json.loads(json.loads(request.content)['messages'][1]['content'])
            if data['content']=='FAIL':return httpx.Response(401,text='private fake error')
            await asyncio.sleep(0.05)
            return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(RESULT)}}]})
        try:
            with patch('src.ai_review_suggestion.ReviewProvider',side_effect=lambda c:ReviewProvider(c,transport=httpx.MockTransport(handler))):
                response=subprocess.run(['node','--test','--test-name-pattern=resource AI suggestions','tests/resource-ai.cjs'],
                    cwd=Path(__file__).resolve().parents[2],env={**os.environ,'COURSES_TEST_AI_BASE':base},capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=100)
                self.assertEqual(response.returncode,0,response.stdout+response.stderr)
        finally:server.should_exit=True;thread.join(timeout=10);listener.close()
