"""Synthetic credentials and simulated providers only; never call a real model."""
import os
import json
import unittest
from unittest.mock import patch, AsyncMock
from importlib import import_module
import httpx
from fastapi import FastAPI, Depends, HTTPException
from src.ai_platform import platform_config
from src.ai_provider import request_config
from src.ai_mistake import AIError
from src.ai_routes import register as register_all
from analysis_fixtures import result as analysis_result

ENV={'PLATFORM_AI_ENABLED':'true','PLATFORM_AI_PROVIDER':'compatible',
     'PLATFORM_AI_API_KEY':'synthetic-server-only','PLATFORM_AI_MODEL':'synthetic-model',
     'PLATFORM_AI_BASE_URL':'https://models.example.test/v1'}


class PlatformTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.env=patch.dict(os.environ,ENV,clear=True);self.env.start();self.addCleanup(self.env.stop)

    def app(self, allowed=True):
        app=FastAPI()
        async def auth():
            if allowed is False:raise HTTPException(401,detail='LOGIN_REQUIRED')
        register_all(app,dependencies=None if allowed is None else [Depends(auth)])
        return app

    async def test_status_never_calls_model_or_exposes_credentials(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app()),base_url='http://test') as client:
            with patch('src.ai_mistake.DeepSeekProvider.complete_json',side_effect=AssertionError('no network')):
                response=await client.get('/api/ai/platform-status')
            self.assertEqual(response.json(),{'available':True,'provider':'platform','model':'synthetic-model'})
            self.assertEqual(response.headers['cache-control'],'no-store')
            self.assertNotIn('synthetic-server-only',response.text)
            with patch.dict(os.environ,{'PLATFORM_AI_ENABLED':'false'}):
                self.assertFalse((await client.get('/api/ai/platform-status')).json()['available'])
        for allowed,status in [(False,401),(None,503)]:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app(allowed)),base_url='http://test') as client:
                self.assertEqual((await client.get('/api/ai/platform-status')).status_code,status)
                self.assertEqual((await client.post('/api/ai/outline-polish',json={})).status_code,status)

    async def test_credentials_do_not_mix_or_fallback(self):
        body={'provider':'platform','confirm_cost':True}
        self.assertEqual(request_config(body).api_key,'synthetic-server-only')
        for field in ['api_key','base_url','workspace_id','model']:
            with self.assertRaises(AIError):request_config({**body,field:'override'})
        with self.assertRaises(AIError):request_config({'provider':'platform'})
        with patch.dict(os.environ,{'PLATFORM_AI_ENABLED':'false'}):
            with self.assertRaises(AIError):request_config(body)
        own=request_config({'provider':'deepseek','api_key':'synthetic-own-only','model':'deepseek-flash','confirm_cost':True})
        self.assertEqual(own.api_key,'synthetic-own-only')
        self.assertEqual(platform_config().api_key,'synthetic-server-only')
        with self.assertRaises(AIError):request_config({'provider':'deepseek','model':'deepseek-flash','confirm_cost':True})

    async def test_each_feature_binds_platform_credentials(self):
        cases=[
            ('ai_answer_draft',{'question':'题目','question_format':'open','choice_type':'single','options':[]}),
            ('ai_review_suggestion',{'kind':'note','content':'正文'}),
            ('ai_creation_review',{'kind':'note','content':'正文'}),
            ('ai_material_draft',{'kind':'note','mode_id':'self_explain','content':'正文'}),
            ('ai_review_feedback',{'mode_id':'standard','question':'题目','student_answer':'作答'}),
            ('ai_outline',{'title':'标题','text':'正文'}),
            ('ai_assessment_chart',{'action':'extract','title':'考核','source':'考试占比60%'})]
        app=self.app()
        for name,data in cases:
            module=import_module('src.'+name)
            async def simulated(request,runner,parsed):
                self.assertEqual(runner.config.api_key,'synthetic-server-only')
                self.assertEqual(runner.config.model,'synthetic-model')
                return {'synthetic':True},'provider'
            with self.subTest(name=name),patch.object(module,'_with_disconnect',simulated):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                    response=await client.post(module.PATH,json={'provider':'platform','confirm_cost':True,'input':data})
                self.assertEqual(response.status_code,200,response.text)
                self.assertEqual(response.json()['provider'],'platform')
                self.assertNotIn('synthetic-server-only',response.text)

    async def test_outline_and_connection_with_simulated_model_validation(self):
        app=self.app()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            with patch('src.ai_mistake.DeepSeekProvider.complete_json',AsyncMock(return_value={'outline':'# 标题\n- 要点'})):
                response=await client.post('/api/ai/outline-polish',json={'provider':'platform','confirm_cost':True,'purpose':'outline_draft','input':{'title':'标题','text':'正文'}})
                self.assertEqual(response.status_code,200,response.text)
                self.assertIn('要点',response.json()['result']['outline'])
            with patch('src.ai_mistake.DeepSeekProvider.complete_json',AsyncMock(return_value={'connected':True})):
                response=await client.post('/api/ai/test',json={'provider':'platform','confirm_cost':True,'action':'connection'})
                self.assertEqual(response.status_code,200,response.text)
                self.assertEqual(response.json()['provider'],'platform')
                self.assertEqual(response.json()['model'],'synthetic-model')
            with patch('src.ai_mistake.DeepSeekProvider.complete_json',AsyncMock(return_value=analysis_result())):
                response=await client.post('/api/ai/test',json={'provider':'platform','confirm_cost':True,'action':'classify','input':{'question':'1+1=?','student_answer':'3'}})
                self.assertEqual(response.status_code,200,response.text)
                self.assertIn('analysis',response.json()['result'])

    async def test_platform_and_own_http_transport_are_isolated(self):
        from src.ai_outline import OutlineDraftProvider
        seen=[]
        def upstream(request):
            seen.append(request.headers['authorization'])
            return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'outline':'- 模拟上游要点'})}}]})
        with patch.dict(os.environ,{'PLATFORM_AI_PROVIDER':'deepseek','PLATFORM_AI_MODEL':'deepseek-flash','PLATFORM_AI_BASE_URL':''}),patch('src.ai_outline.OutlineDraftProvider',side_effect=lambda config:OutlineDraftProvider(config,transport=httpx.MockTransport(upstream))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app()),base_url='http://test') as client:
                body={'provider':'platform','confirm_cost':True,'purpose':'outline_draft','input':{'title':'测试','text':'正文'}}
                self.assertEqual((await client.post('/api/ai/outline-polish',json=body)).status_code,200)
                own={**body,'provider':'deepseek','model':'deepseek-flash','api_key':'synthetic-own-only'}
                self.assertEqual((await client.post('/api/ai/outline-polish',json=own)).status_code,200)
                with patch.dict(os.environ,{'PLATFORM_AI_ENABLED':'false'}):
                    response=await client.post('/api/ai/outline-polish',json=body)
                self.assertEqual(response.status_code,503)
                self.assertEqual(response.json(),{'error':'PLATFORM_AI_UNAVAILABLE'})
                self.assertEqual(seen,['Bearer synthetic-server-only','Bearer synthetic-own-only'])


if __name__=='__main__':unittest.main()
