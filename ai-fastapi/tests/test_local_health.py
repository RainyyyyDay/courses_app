import hashlib
from pathlib import Path
import unittest
import httpx
from test_app import app


class LocalHealth(unittest.IsolatedAsyncioTestCase):
    async def test_identity_and_current_test_route(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, client=('127.0.0.1', 1)),
                                     base_url='http://127.0.0.1:3003') as client:
            response = await client.get('/api/ai/local-health')
            self.assertEqual(response.status_code, 200)
            data = response.json()
            project = str(Path(__file__).resolve().parents[2]).casefold()
            self.assertEqual(data['service'], 'courses-local-ai')
            self.assertEqual(data['api_version'], 1)
            self.assertEqual(data['project_id'], hashlib.sha256(project.encode('utf-8')).hexdigest())
            self.assertIn('/api/ai/test', data['routes'])
            self.assertEqual(response.headers['cache-control'], 'no-store')
            denied = await client.get('/api/ai/local-health', headers={'Origin': 'http://evil.invalid'})
            self.assertEqual(denied.status_code, 403)
            # Reaching validation proves the real POST route exists; no model call or Key is used.
            missing_key = await client.post('/api/ai/test', json={'action': 'connection', 'confirm_cost': True})
            self.assertEqual(missing_key.status_code, 400)
            self.assertEqual(missing_key.json()['error'], 'INVALID_API_KEY')
