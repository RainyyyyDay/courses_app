"""Synthetic providers only: no paid API or external DNS requests."""
import json
import socket
import unittest
from unittest.mock import patch
import httpx
from fastapi import FastAPI, Depends
from src.ai_provider import endpoint, public_target, request_config
from src.ai_mistake import AIError, DeepSeekProvider
from src import ai_deepseek_test, ai_answer_draft, ai_review_suggestion, ai_material_draft, ai_review_feedback
from analysis_fixtures import result
from test_material_draft import draft
from test_review_feedback import feedback

BODY=dict(provider='compatible',base_url='https://models.example/v1',model='vendor/model-v2',api_key='synthetic-custom-key',confirm_cost=True)

def address(ip):return [(socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443))]

class CustomTests(unittest.IsolatedAsyncioTestCase):
    def test_configuration(self):
        self.assertEqual(endpoint(BODY['base_url']),'https://models.example/v1/chat/completions')
        self.assertEqual(endpoint(endpoint(BODY['base_url'])),endpoint(BODY['base_url']))
        self.assertEqual(request_config(BODY).provider,'compatible')
        self.assertEqual(request_config(BODY).timeout_ms,90000)
        for url in ['http://models.example','https://localhost','https://127.0.0.1','https://10.0.0.1','https://169.254.169.254','https://[::1]','https://[::ffff:127.0.0.1]','https://a.local','https://a:444','https://u:secret@a','https://a?key=x','https://a/#x']:
            with self.subTest(url=url),self.assertRaises(AIError):endpoint(url)
        for change in [dict(model='bad model'),dict(confirm_cost=False),dict(api_key=''),dict(provider='unknown'),dict(base_url='')]:
            with self.assertRaises(AIError):request_config({**BODY,**change})
        with self.assertRaises(AIError):request_config({**BODY,'provider':'deepseek','model':'deepseek-flash'})

    async def test_dns_pin_and_private_or_mixed_dns_rejected(self):
        for answers in [address('127.0.0.1'),address('10.0.0.1'),address('8.8.8.8')+address('192.168.1.1')]:
            with patch('socket.getaddrinfo',return_value=answers),self.assertRaises(AIError):await public_target(BODY['base_url'])
        with patch('socket.getaddrinfo',return_value=address('8.8.8.8')):
            url,headers,ext=await public_target(BODY['base_url'])
        self.assertEqual(str(url),'https://8.8.8.8/v1/chat/completions')
        self.assertEqual(headers,{'Host':'models.example'})
        self.assertEqual(ext,{'sni_hostname':'models.example'})

    async def test_protocol_and_redirect_rejection(self):
        seen=[]
        def handler(request):
            seen.append(request)
            self.assertEqual(str(request.url),'https://8.8.8.8/v1/chat/completions')
            self.assertEqual(request.headers['host'],'models.example')
            self.assertEqual(request.extensions['sni_hostname'],'models.example')
            self.assertEqual(request.headers['authorization'],'Bearer '+BODY['api_key'])
            body=json.loads(request.content)
            self.assertEqual(body['model'],BODY['model'])
            self.assertNotIn('thinking',body)
            return httpx.Response(302,headers={'Location':'https://127.0.0.1/private'})
        provider=DeepSeekProvider(request_config(BODY),transport=httpx.MockTransport(handler))
        with patch('socket.getaddrinfo',return_value=address('8.8.8.8')),self.assertRaises(AIError):await provider.complete_json({},'JSON')
        self.assertEqual(len(seen),1)

    async def test_every_task_route(self):
        cases=[
          (ai_deepseek_test,'DeepSeekProvider',dict(action='connection'),{'connected':True}),
          (ai_deepseek_test,'DeepSeekProvider',dict(action='classify',input=dict(question='1+1=?',student_answer='3')),result('retry')),
          (ai_answer_draft,'AnswerProvider',dict(input=dict(question='1+1=?',question_format='open')),dict(answer='2',explanation='相加',choice_answer=[],caveats=[],needs_more_information=False)),
          (ai_review_suggestion,'ReviewProvider',dict(input=dict(kind='note',content='学习内容')),dict(review_method='standard',reason='核对要点',needs_review=True)),
          (ai_material_draft,'MaterialProvider',dict(input=dict(kind='note',mode_id='cloze',content='首都北京')),draft('cloze')),
          (ai_review_feedback,'FeedbackProvider',dict(input=dict(mode_id='self_explain',question='解释加减关系',student_answer='不会',reference='加减互逆',rubric='概念和例子')),feedback())]
        async def allow():pass
        for module,name,extra,value in cases:
            with self.subTest(route=module.PATH,extra=extra):
                app=FastAPI();module.register(app,dependencies=[Depends(allow)])
                cls=getattr(module,name)
                def handler(request):return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(value)}}]})
                with patch.object(module,name,side_effect=lambda c:cls(c,transport=httpx.MockTransport(handler))),patch('socket.getaddrinfo',return_value=address('8.8.8.8')):
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                        response=await client.post(module.PATH,json={**BODY,**extra})
                self.assertEqual(response.status_code,200,response.text)
                self.assertEqual(response.json()['provider'],'compatible')
                self.assertNotIn(BODY['api_key'],response.text)

    async def test_fake_ip_is_distinguished_from_private_network(self):
        with patch('socket.getaddrinfo',return_value=address('198.18.0.120')):
            with self.assertRaises(AIError) as caught:await public_target(BODY['base_url'])
        self.assertEqual(caught.exception.code,'AI_DNS_FAKE_IP')

    async def test_connection_and_read_timeout_are_distinguished(self):
        from src.ai_mistake import Classifier, Config
        for error,code in [(httpx.ConnectTimeout('hidden'),'AI_CONNECT_TIMEOUT'),(httpx.ReadTimeout('hidden'),'AI_TIMEOUT')]:
            class Provider:
                async def classify(self,data,rules):raise error
            runner=Classifier(Config(),provider=Provider())
            with self.assertRaises(AIError) as caught:await runner.run({},lambda x:x)
            self.assertEqual(caught.exception.code,code)

    async def test_precise_upstream_failures_and_glm_budget(self):
        cases=[
          (400,{'error':{'code':'1211','message':BODY['api_key']}},'AI_MODEL_NOT_FOUND'),
          (403,{'error':{'code':'1220','message':BODY['api_key']}},'AI_MODEL_PERMISSION'),
          (429,{'error':{'code':'1113','message':BODY['api_key']}},'AI_BALANCE_UNAVAILABLE'),
          (400,{'error':{'code':'1210','message':BODY['api_key']}},'AI_REQUEST_REJECTED'),
          (200,{'choices':[{'finish_reason':'length','message':{'content':'','reasoning_content':'partial'}}]},'AI_OUTPUT_LIMIT'),
          (200,{'choices':[{'finish_reason':'stop','message':{'content':''}}]},'AI_EMPTY_RESPONSE'),
          (200,{'choices':[{'finish_reason':'stop','message':{'content':'not json'}}]},'AI_INVALID_JSON')]
        for status,payload,expected in cases:
            with self.subTest(expected=expected):
                def handler(request):
                    self.assertEqual(json.loads(request.content)['max_tokens'],8192)
                    return httpx.Response(status,json=payload)
                provider=DeepSeekProvider(request_config({**BODY,'model':'glm-5.3-flash'}),transport=httpx.MockTransport(handler))
                with patch('socket.getaddrinfo',return_value=address('8.8.8.8')),self.assertRaises(AIError) as caught:
                    await provider.complete_json({},'JSON')
                self.assertEqual(caught.exception.code,expected)
                self.assertNotIn(BODY['api_key'],json.dumps(caught.exception.details))

    async def test_connection_probe_is_small_and_preserves_safe_service_error(self):
        async def allow():pass
        for failure in (False,True):
            app=FastAPI();ai_deepseek_test.register(app,dependencies=[Depends(allow)])
            def handler(request):
                prompt=json.loads(request.content)['messages'][0]['content']
                self.assertIn('connected',prompt)
                if failure:return httpx.Response(400,json={'error':{'code':'1211','message':BODY['api_key']}})
                return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'{"connected":true}'}}]})
            with patch.object(ai_deepseek_test,'DeepSeekProvider',side_effect=lambda c:DeepSeekProvider(c,transport=httpx.MockTransport(handler))),patch('socket.getaddrinfo',return_value=address('8.8.8.8')):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                    response=await client.post(ai_deepseek_test.PATH,json={**BODY,'action':'connection'})
            self.assertNotIn(BODY['api_key'],response.text)
            if failure:self.assertEqual(response.json(),{'error':'AI_MODEL_NOT_FOUND','upstream_status':400,'upstream_code':'1211'})
            else:self.assertEqual(response.status_code,200)

    async def test_glm_json_mode_and_material_code_fence(self):
        config=request_config({**BODY,'base_url':'https://open.bigmodel.cn/api/paas/v4','model':'glm-5.3-flash'})
        value=draft('standard')
        for content,expected in [('```json\n'+json.dumps(value,ensure_ascii=False)+'\n```',None),('以下是材料：'+json.dumps(value),'AI_INVALID_JSON')]:
            def handler(request):
                body=json.loads(request.content)
                self.assertEqual(body['response_format'],{'type':'json_object'})
                self.assertIn('JSON',body['messages'][0]['content'])
                self.assertEqual(request.headers['host'],'open.bigmodel.cn')
                return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':content}}]})
            provider=ai_material_draft.MaterialProvider(config,transport=httpx.MockTransport(handler))
            runner=ai_material_draft.MaterialRunner(config,provider=provider)
            with patch('socket.getaddrinfo',return_value=address('8.8.8.8')):
                if expected:
                    with self.assertRaises(AIError) as caught:await runner.classify({'mode_id':'standard','kind':'note','content':'原文'})
                    self.assertEqual(caught.exception.code,expected)
                else:
                    normalized,source=await runner.classify({'mode_id':'standard','kind':'note','content':'原文'})
                    self.assertEqual(source,'provider');self.assertEqual(normalized['material']['prompt'],value['material']['prompt'])

    async def test_domestic_provider_parameters_and_json_replies(self):
        from src.ai_provider import completion_options
        cases=[
            ('https://open.bigmodel.cn/api/paas/v4','glm-5.3-flash',{'response_format':{'type':'json_object'}}),
            ('https://api.deepseek.com','deepseek-flash',{'thinking':{'type':'disabled'}}),
            ('https://dashscope.aliyuncs.com/compatible-mode/v1','qwen-plus',{'enable_thinking':False}),
            *[('https://dashscope.aliyuncs.com/compatible-mode/v1',model,{'enable_thinking':False,'response_format':{'type':'json_object'}}) for model in ('qwen3.7-plus','qwen3.8-max','qwen3.8-flash')],
            ('https://space.cn-beijing.maas.aliyuncs.com/compatible-mode/v1','qwen-plus',{'enable_thinking':False}),
            ('https://api.moonshot.cn/v1','kimi-k3',{'reasoning_effort':'low'}),
            ('https://ark.cn-beijing.volces.com/api/v3','doubao-seed-2-1-pro-260915',{'thinking':{'type':'disabled'}}),
            ('https://ark.cn-beijing.volces.com/api/v3','ep-custom-id',{}),
            ('https://api.siliconflow.cn/v1','Qwen/Qwen2.5-72B-Instruct',{'response_format':{'type':'json_object'}})]
        for base,model,expected in cases:
            with self.subTest(base=base,model=model):
                config=request_config({**BODY,'base_url':base,'model':model})
                options=completion_options(config)
                for key,value in expected.items():self.assertEqual(options[key],value)
                def handler(request):
                    body=json.loads(request.content)
                    self.assertEqual(body['model'],model)
                    for key,value in expected.items():self.assertEqual(body[key],value)
                    if model=='ep-custom-id':self.assertNotIn('thinking',body)
                    return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':'{"connected":true}'}}]})
                provider=DeepSeekProvider(config,transport=httpx.MockTransport(handler))
                with patch('socket.getaddrinfo',return_value=address('8.8.8.8')):
                    self.assertEqual(await provider.complete_json({},'JSON'),{'connected':True})
        generic=request_config(BODY)
        self.assertEqual(completion_options(generic),{'max_tokens':1600})

    async def test_foreign_services_parameters_and_all_business_routes(self):
        vendors=[
          ('https://api.openai.com/v1','gpt-5.4-mini',{}),
          *[('https://api.openai.com/v1',model,{}) for model in ('gpt-6.1-sol','gpt-6-luna','gpt-6-astra')],
          ('https://generativelanguage.googleapis.com/v1beta/openai','gemini-3.8-flash',{}),
          ('https://generativelanguage.googleapis.com/v1beta/openai','gemini-4-argon',{}),
          ('https://api.anthropic.com/v1','claude-sonnet-5-5',{'workspace_id':'wrkspc_test'}),
          ('https://api.anthropic.com/v1','claude-opus-5-5',{'workspace_id':'wrkspc_test'}),
          ('https://api.x.ai/v1','grok-4.7',{})]
        cases=[
          (ai_deepseek_test,'DeepSeekProvider',dict(action='connection'),{'connected':True}),
          (ai_deepseek_test,'DeepSeekProvider',dict(action='classify',input=dict(question='1+1=?',student_answer='3')),result('retry')),
          (ai_answer_draft,'AnswerProvider',dict(input=dict(question='1+1=?',question_format='open')),dict(answer='2',explanation='相加',choice_answer=[],caveats=[],needs_more_information=False)),
          (ai_review_suggestion,'ReviewProvider',dict(input=dict(kind='note',content='学习内容')),dict(review_method='standard',reason='核对要点',needs_review=True)),
          (ai_material_draft,'MaterialProvider',dict(input=dict(kind='note',mode_id='cloze',content='首都北京')),draft('cloze')),
          (ai_review_feedback,'FeedbackProvider',dict(input=dict(mode_id='self_explain',question='解释加减关系',student_answer='不会',reference='加减互逆',rubric='概念和例子')),feedback())]
        async def allow():pass
        for base,model,extra_headers in vendors:
          for module,name,extra,value in cases:
            with self.subTest(base=base,route=module.PATH,action=extra.get('action')):
                app=FastAPI();module.register(app,dependencies=[Depends(allow)])
                cls=getattr(module,name)
                def handler(request):
                    body=json.loads(request.content)
                    self.assertEqual(body['model'],model)
                    self.assertEqual(request.headers['authorization'],'Bearer '+BODY['api_key'])
                    if 'api.openai.com' in base:
                        self.assertIn('max_completion_tokens',body);self.assertNotIn('max_tokens',body);self.assertEqual(body['reasoning_effort'],'low')
                    if 'anthropic.com' in base:
                        self.assertEqual(request.headers['anthropic-workspace-id'],'wrkspc_test');self.assertNotIn('response_format',body)
                    else:self.assertNotIn('anthropic-workspace-id',request.headers)
                    self.assertNotIn('enable_thinking',body)
                    return httpx.Response(200,json={'choices':[{'finish_reason':'stop','message':{'content':json.dumps(value)}}]})
                with patch.object(module,name,side_effect=lambda c:cls(c,transport=httpx.MockTransport(handler))),patch('socket.getaddrinfo',return_value=address('8.8.8.8')):
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                        response=await client.post(module.PATH,json={**BODY,'base_url':base,'model':model,**extra_headers,**extra})
                self.assertEqual(response.status_code,200,response.text)
                self.assertNotIn(BODY['api_key'],response.text)
        for changes in [dict(workspace_id='bad\r\nheader'),dict(workspace_id='wrkspc_test'),dict(workspace_id='wrkspc_test',base_url={})]:
            with self.assertRaises(AIError):request_config({**BODY,**changes})

    def test_foreign_errors_distinguish_account_quota_and_model_from_rate_limit(self):
        from src.ai_provider import upstream_failure
        for raw,expected in [('insufficient_quota','AI_BALANCE_UNAVAILABLE'),('invalid_api_key','AI_AUTH_FAILED'),('model_not_found','AI_MODEL_NOT_FOUND'),('rate_limit_error','AI_UPSTREAM_RATE_LIMITED')]:
            failure=upstream_failure(429,{'error':{'code':raw,'message':BODY['api_key']}})
            self.assertEqual(failure.code,expected)
            self.assertNotIn(BODY['api_key'],str(failure.details))
        self.assertEqual(upstream_failure(401,{'error':{'type':'authentication_error','message':BODY['api_key']}}).code,'AI_AUTH_FAILED')
