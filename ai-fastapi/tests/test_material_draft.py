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
from src.ai_material_draft import PATH, MaterialProvider, normalize, register
from src.ai_mistake import Config
from test_app import local_only, frontend, FRONTEND


def draft(mode):
    material={'prompt':'解释北京作为首都的含义','reference':'北京是首都，省会是省级行政中心','rubric':'覆盖定义和范围','blanks':[],'objects':[],'dimensions':[]}
    if mode=='cloze':material.update(prompt='中国首都是【b1】',blanks=[{'id':'b1','answer':'北京','aliases':['北京市'],'hint':'城市'}])
    if mode=='contrast':material.update(objects=['首都','省会'],dimensions=['管辖范围'])
    if mode=='reading':material.update(prompt='中国首都是北京。',reference='',rubric='')
    return {'material':material,'needs_more_information':False,'caveats':['请人工核实'],'needs_review':True}


def response(value,status=200):
    return httpx.Response(status,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(value)}}]})


class MaterialRoutes(unittest.IsolatedAsyncioTestCase):
    async def request(self,body=None,*,auth=True,result=None,status=200):
        app=FastAPI()
        async def allow():pass
        register(app,dependencies=[Depends(allow)] if auth else None)
        body=body or {'provider':'deepseek','api_key':'synthetic-material-key','model':'deepseek-flash','confirm_cost':True,'input':{'kind':'note','mode_id':'cloze','content':'首都北京'}}
        def handler(request):
            self.assertEqual(str(request.url),'https://api.deepseek.com/chat/completions')
            self.assertIn('复习材料草稿助手',json.loads(request.content)['messages'][0]['content'])
            return response(result if result is not None else draft(body['input']['mode_id']),status)
        with patch('src.ai_material_draft.MaterialProvider',side_effect=lambda c:MaterialProvider(c,transport=httpx.MockTransport(handler))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                r=await client.post(PATH,json=body)
        self.assertNotIn('synthetic-material-key',r.text)
        return r

    async def test_all_material_modes_and_content_types(self):
        for mode in ('standard','cloze','self_explain','contrast','reading'):
            for kind in ('mistake','material','note'):
                body={'provider':'deepseek','api_key':'synthetic-material-key','model':'deepseek-flash','confirm_cost':True,'input':{'kind':kind,'mode_id':mode,'content':'北京是首都，省会是省级行政中心'}}
                r=await self.request(body)
                self.assertEqual(r.status_code,200,r.text)
                self.assertEqual(r.json()['mode_id'],mode)
                self.assertTrue(r.json()['draft']['needs_review'])
                self.assertEqual(r.headers['cache-control'],'no-store')

    async def test_validation_auth_consent_and_no_fallback(self):
        self.assertEqual((await self.request(auth=False)).status_code,503)
        base={'provider':'deepseek','api_key':'synthetic-material-key','model':'deepseek-flash','confirm_cost':True,'input':{'kind':'note','mode_id':'cloze','content':'首都北京'}}
        for changes in ({'confirm_cost':False},{'api_key':''},{'model':'unknown'},{'provider':'mock'},{'url':'https://example.com'}):
            self.assertEqual((await self.request({**base,**changes})).status_code,400)
        for changes in ({'mode_id':'retry'},{'content':'a'*4001},{'content':''},{'kind':'unknown'}):
            self.assertEqual((await self.request({**base,'input':{**base['input'],**changes}})).status_code,400)
        self.assertEqual((await self.request(status=401)).json()['error'],'AI_AUTH_FAILED')
        invalid=draft('cloze');invalid['material']['blanks'][0]['id']='b2'
        self.assertEqual((await self.request(result=invalid)).json()['error'],'INVALID_RESPONSE')

    async def test_missing_information_and_bounded_schema(self):
        value={'material':None,'needs_more_information':True,'caveats':['请补充比较对象']}
        self.assertEqual((await self.request(result=value)).status_code,200)
        self.assertIsNone(normalize({**value,'needs_more_information':False},'contrast'))
        self.assertIsNone(normalize(draft('self_explain'),'cloze'))
        invalid=draft('contrast');invalid['material']['objects']=[]
        self.assertIsNone(normalize(invalid,'contrast'))
        invalid=draft('cloze');invalid['material']['blanks'][0]['answer']='。'
        self.assertIsNone(normalize(invalid,'cloze'))
        invalid=draft('reading');invalid['material']['prompt']='a'*4001
        self.assertIsNone(normalize(invalid,'reading'))
        app=FastAPI();register(app)
        with self.assertRaises(ValueError):register(app)


class MaterialBrowser(unittest.TestCase):
    def test_real_website_edit_confirm_and_practice(self):
        app=FastAPI()
        with patch('src.ai_material_draft.Config',return_value=Config(rate_max=100)):
            register(app,dependencies=[Depends(local_only)])
        app.add_api_route('/',frontend,methods=['GET'],response_class=HTMLResponse,dependencies=[Depends(local_only)])
        app.mount('/',StaticFiles(directory=FRONTEND))
        listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen(128)
        base='http://127.0.0.1:'+str(listener.getsockname()[1])
        server=uvicorn.Server(uvicorn.Config(app,access_log=False,log_level='error'))
        thread=threading.Thread(target=server.run,kwargs={'sockets':[listener]},daemon=True);thread.start()
        async def handler(request):
            data=json.loads(json.loads(request.content)['messages'][1]['content'])
            if data['content']=='FAIL':return response({},401)
            if data['content']=='INSUFFICIENT':return response({'material':None,'needs_more_information':True,'caveats':['请补充比较对象']})
            await asyncio.sleep(0.05)
            return response(draft(data['mode_id']))
        try:
            with patch('src.ai_material_draft.MaterialProvider',side_effect=lambda c:MaterialProvider(c,transport=httpx.MockTransport(handler))):
                r=subprocess.run(['node','--test','--test-name-pattern=material AI shared','tests/review-material-ai.cjs'],cwd=Path(__file__).resolve().parents[2],env={**os.environ,'COURSES_TEST_AI_BASE':base},capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=100)
                self.assertEqual(r.returncode,0,r.stdout+r.stderr)
        finally:server.should_exit=True;thread.join(timeout=10);listener.close()
