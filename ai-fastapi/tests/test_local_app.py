"""Local harness routes and a real TCP request through the frontend adapter."""
from pathlib import Path
import socket
import subprocess
import threading
import time
import unittest

import httpx
import uvicorn
from test_app import app, demo
from fastapi.responses import HTMLResponse


class LocalRoutes(unittest.IsolatedAsyncioTestCase):
    async def test_browser_origin_and_mock_contract(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 1)), base_url='http://localhost:3002') as client:
            response = await client.post('/api/ai/classify', headers={'Origin':'http://localhost:3002'}, json={'question':'1+1=?','student_answer':'3','error_type':'careless'})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['review_method'], 'retry')
            self.assertEqual(response.headers['x-ai-provider'], 'mock')
            for headers in [{'Origin':'http://evil.invalid'}, {'X-Forwarded-For':'127.0.0.1'}, {'Host':'evil.invalid'}]:
                self.assertEqual((await client.post('/api/ai/classify', headers=headers, json={})).status_code, 403)
            self.assertEqual((await client.post('/api/ai/classify', content='{', headers={'Content-Type':'application/json'})).status_code, 400)
            self.assertEqual((await client.post('/api/ai/classify', content='{}')).status_code, 415)

    async def test_demo_and_public_files_only(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 1)), base_url='http://127.0.0.1:3002') as client:
            demo = await client.get('/demo')
            self.assertEqual(demo.status_code, 200)
            self.assertIn('window.COURSES_AI_API_BASE="/api"', demo.text)
            self.assertNotIn('<script src="app.js"></script>', demo.text)
            for path in ['/', '/index.html']:
                page = await client.get(path)
                self.assertIn('window.COURSES_AI_API_BASE="/api"', page.text)
                self.assertIn('window.COURSES_AI_LOCAL_MOCK=true', page.text)
                self.assertIn('<script src="app.js"></script>', page.text)
                self.assertEqual(page.headers['cache-control'], 'no-store')
                self.assertIn('js/mistakeAi.js?v=20261021-settings-2', page.text)
            self.assertEqual((await client.get('/js/ai.js')).status_code, 200)
            for path in ['/js/ai.js', '/js/mistakeAi.js?v=20261021-analysis-1', '/style.css?v=20261021-analysis-1']:
                self.assertEqual((await client.get(path)).headers['cache-control'], 'no-store')
            for path in ['/.env','/back/data/database.db','/src/ai_mistake.py']:
                self.assertEqual((await client.get(path)).status_code, 404)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('192.0.2.1', 1)), base_url='http://localhost') as client:
            self.assertEqual((await client.post('/api/ai/classify', json={})).status_code, 403)


class LiveHTTP(unittest.TestCase):
    def test_frontend_adapter_over_real_http(self):
        async def browser_fixture():
            html = await demo()
            scenario = """<script>
window.addEventListener('load', async () => {
  const result = document.createElement('pre'); result.id='regressionResult';
  try {
    await requestMistakeAi();
    if (mistakeAiState.result?.review_method !== 'retry' ||
        !mistakeAiElement('Reason').textContent.includes('Mock')) throw Error('HTTP classification failed');
    mistakeAiElement('Method').value='self_explain'; confirmMistakeAiSuggestion();
    if (!mistakeAiElement('Confirmation').textContent.includes('已保存到本浏览器') ||
        mistakeDetailState.row.mistake_type !== 'knowledge') throw Error('local confirmation failed');
    result.textContent='HTTP_BROWSER_PASS';
  } catch (error) { result.textContent='FAIL: '+error.message; }
  document.body.append(result);
});
</script>"""
            return HTMLResponse(html.replace('</body>', scenario + '</body>'))
        # Test-only page, placed before the static mount and removed afterwards.
        app.add_api_route('/__http_test', browser_fixture)
        fixture_route = app.router.routes.pop()
        app.router.routes.insert(0, fixture_route)
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        base = f'http://127.0.0.1:{listener.getsockname()[1]}'
        server = uvicorn.Server(uvicorn.Config(app, log_level='error', proxy_headers=False))
        thread = threading.Thread(target=server.run, kwargs={'sockets':[listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 10
            while not server.started and thread.is_alive() and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(server.started, 'local server failed to start')
            root = Path(__file__).resolve().parents[2]
            script = r"""
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const base=process.argv[1], root=process.argv[2];
const ctx=vm.createContext({fetch,AbortController,TextEncoder,setTimeout,clearTimeout,COURSES_AI_API_BASE:base+'/api/'});
vm.runInContext("const API='http://unused.invalid/api';"+fs.readFileSync(root+'/fronted/js/ai.js','utf8'),ctx);
(async()=>{
  for(const [error_type,method] of [['careless','retry'],['knowledge_gap','cloze'],['reasoning_gap','self_explain'],['unknown','unclassified']]){
    ctx.input={question:'1+1=?',student_answer:'3',error_type};
    const result=await vm.runInContext('classifyMistakeWithAi(input)',ctx);
    assert.equal(result.review_method,method);assert.equal(result.needs_review,true);
  }
  const denied=await fetch(base+'/api/ai/classify',{method:'POST',headers:{Origin:'http://evil.invalid','Content-Type':'application/json'},body:'{}'});
  assert.equal(denied.status,403);
  console.log('real HTTP frontend adapter: four mappings and cross-origin rejection passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
            result = subprocess.run(['node','-e',script,base,str(root)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            browser_script = r"""
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {runBrowser}=require(process.argv[2]+'/tests/browser-driver.cjs');
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
assert.ok(chrome,'Chrome/Edge required');
(async()=>{
 for(const viewport of [[1280,960],[390,844]]){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'courses-ai-http-'));
  try {
   const html=await runBrowser({chrome,profile,url:process.argv[1]+'/__http_test',viewport});
   assert.ok(html.includes('HTTP_BROWSER_PASS'),html.slice(-2500));
  } finally {fs.rmSync(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 }
 console.log('desktop/mobile browser to FastAPI HTTP passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
"""
            result = subprocess.run(['node','-e',browser_script,base,str(root)], capture_output=True, text=True, timeout=90)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        finally:
            app.router.routes.remove(fixture_route)
            server.should_exit = True
            thread.join(timeout=10)
            listener.close()
        self.assertFalse(thread.is_alive())
