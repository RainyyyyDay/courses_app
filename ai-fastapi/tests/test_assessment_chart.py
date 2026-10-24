import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import Depends, FastAPI

from src.ai_assessment_chart import AssessmentChartProvider, normalize, parse_input, register
from src.ai_mistake import AIError


class AssessmentChartModel(unittest.TestCase):
    def test_extract_input_accepts_incomplete_but_valid_total(self):
        data = parse_input({
            'action': 'extract', 'title': '课程考核', 'source': '考勤10%，期末60%。',
            'instruction': '', 'current': [],
        })
        result = normalize({
            'title': '课程考核',
            'items': [
                {'label': '考勤', 'percent': 10, 'detail': '签到'},
                {'label': '期末', 'percent': 60, 'detail': '闭卷'},
            ],
        }, data)
        self.assertEqual(sum(item['percent'] for item in result['items']), 70)
        self.assertTrue(result['needs_review'])
        self.assertEqual(data['source'], '考勤10%，期末60%。')

    def test_missing_source_and_conflicting_totals_are_rejected(self):
        with self.assertRaises(AIError):
            parse_input({'action': 'extract', 'title': '课程', 'source': ''})
        data = parse_input({
            'action': 'extract', 'title': '课程', 'source': '正文',
        })
        with self.assertRaises(AIError):
            normalize({
                'title': '课程',
                'items': [
                    {'label': '平时', 'percent': 60, 'detail': ''},
                    {'label': '期末', 'percent': 50, 'detail': ''},
                ],
            }, data)

    def test_edit_requires_current_chart(self):
        with self.assertRaises(AIError):
            parse_input({
                'action': 'edit', 'title': '课程', 'source': '正文',
                'instruction': '精简说明', 'current': [],
            })


class AssessmentChartRoute(unittest.IsolatedAsyncioTestCase):
    async def test_real_route_returns_structured_draft_without_echoing_key(self):
        app = FastAPI()
        async def allowed(): pass
        register(app, dependencies=[Depends(allowed)])
        result = {
            'title': '课程考核',
            'items': [
                {'label': '考勤', 'percent': 10, 'detail': '签到'},
                {'label': '期末', 'percent': 60, 'detail': '闭卷'},
            ],
        }
        def handler(request):
            value = json.loads(request.content)
            self.assertIn('不得猜测', value['messages'][0]['content'])
            return httpx.Response(200, json={'choices': [{
                'finish_reason': 'stop',
                'message': {'content': json.dumps(result)},
            }]})
        with patch('src.ai_assessment_chart.AssessmentChartProvider',
                   side_effect=lambda config: AssessmentChartProvider(config, transport=httpx.MockTransport(handler))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.post('/api/ai/assessment-chart', json={
                    'provider': 'deepseek', 'api_key': 'synthetic-chart-key',
                    'model': 'deepseek-flash', 'confirm_cost': True,
                    'input': {'action': 'extract', 'title': '课程',
                              'source': '考勤10%，期末60%。', 'instruction': '', 'current': []},
                })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['result']['items'][1]['label'], '期末')
        self.assertNotIn('synthetic-chart-key', response.text)


if __name__ == '__main__':
    unittest.main()
