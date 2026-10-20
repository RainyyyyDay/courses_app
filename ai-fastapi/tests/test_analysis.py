"""Prompt/contract regressions with synthetic answers; not a real-model quality score."""
import json
import unittest
from unittest.mock import patch

import httpx
from fastapi import Depends, FastAPI

from analysis_fixtures import result
from src.ai_mistake import (Classifier, Config, DeepSeekProvider, DEFAULT_RULES,
                            normalize_result, parse_input)
from src.ai_deepseek_test import register


class AnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def run_case(self, data, expected):
        calls = []
        def upstream(request):
            body = json.loads(request.content)
            calls.append(body)
            self.assertEqual(json.loads(body['messages'][1]['content']), data)
            prompt = body['messages'][0]['content']
            self.assertNotIn(DEFAULT_RULES['instructions'], prompt)
            self.assertNotIn('knowledge_gap→cloze', prompt)
            self.assertIn('参考答案也可能缺失或有误', prompt)
            self.assertIn('possible_causes', prompt)
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {
                'content': json.dumps(expected)}}]})
        config = Config(provider='deepseek', api_key='synthetic-analysis-key')
        classifier = Classifier(config, provider=DeepSeekProvider(config, transport=httpx.MockTransport(upstream)))
        actual, source = await classifier.classify(data)
        self.assertEqual(source, 'provider')
        self.assertEqual(actual['review_method'], expected['review_method'])
        self.assertEqual(actual['analysis']['answer_status'], expected['analysis']['answer_status'])
        self.assertTrue(actual['needs_review'])
        self.assertEqual(len(calls), 1)
        self.assertIn('material_requirements', actual['analysis'])
        return actual

    async def test_unknown_cause_arithmetic_difference_is_not_forced_to_cloze(self):
        # Fake response expresses the desired behavior; real model still needs manual evaluation.
        expected = result()
        expected['analysis']['observations'] = ['1+1 的计算结果为2，学生填1；未提供计算过程。']
        expected['analysis']['reference_check'] = '本题参考答案2可核对；仍不能仅据一次错误确定错因。'
        actual = await self.run_case({'question': '1+1=?', 'student_answer': '1', 'correct_answer': '2',
                                      'mistake_category': 'knowledge', 'question_format': 'unknown'}, expected)
        self.assertEqual(actual['analysis']['possible_causes'], [])
        self.assertTrue(actual['analysis']['follow_up_questions'])

    async def test_explicit_process_can_support_a_reasoning_hypothesis(self):
        expected = result('self_explain')
        expected['analysis']['possible_causes'] = [{'category': 'thinking', 'support': 'supported',
            'explanation': '可能把可交换运算的规则误用于减法。', 'evidence': '过程写明把减法交换前后项，需要核对规则理解。'}]
        actual = await self.run_case({'question': '3-1=?', 'student_answer': '-2', 'correct_answer': '2',
            'solution_steps': '把3-1交换成1-3，算得-2。', 'error_type': ''}, expected)
        self.assertEqual(actual['analysis']['possible_causes'][0]['support'], 'supported')

    async def test_fact_recall_can_use_cloze_for_a_reason_not_a_category_lookup(self):
        expected = result('cloze')
        expected['reason'] = '可用首都事实提取练习；不是看到知识类就固定选挖空。'
        expected['analysis']['possible_causes'] = [{'category': 'knowledge', 'support': 'possible',
            'explanation': '可能未记牢首都事实。', 'evidence': '学生自述没有记住；仍需区分事实混淆和输入失误。'}]
        await self.run_case({'question': '中国首都是？', 'student_answer': '上海', 'correct_answer': '北京',
                             'solution_steps': '我想不起来首都是哪里。'}, expected)

    async def test_correct_answer_does_not_invent_a_cause(self):
        expected = result(status='correct')
        expected['analysis']['follow_up_questions'] = []
        actual = await self.run_case({'question': '1+1=?', 'student_answer': '2', 'correct_answer': '2'}, expected)
        self.assertEqual(actual['analysis']['possible_causes'], [])

    async def test_missing_reference_retains_uncertainty_and_action(self):
        expected = result(status='uncertain')
        expected['analysis']['reference_check'] = '未提供完整题意和参考要点，无法可靠核对答案。'
        await self.run_case({'question': '说明这个方案为什么更好', 'student_answer': '因为更快'}, expected)

    async def test_suspect_reference_and_conflicting_user_hint_are_only_evidence(self):
        expected = result(status='correct')
        expected['analysis']['reference_check'] = '1+1应为2，参考3可疑，不能据此认定学生作答错误。'
        actual = await self.run_case({'question': '1+1=?', 'student_answer': '2', 'correct_answer': '3',
                                      'error_type': 'knowledge_gap'}, expected)
        self.assertEqual(actual['analysis']['possible_causes'], [])

    async def test_real_route_accepts_no_error_hint_and_ignores_extra_result_secrets(self):
        app = FastAPI()
        async def allowed():
            pass  # Test dependency only.
        register(app, dependencies=[Depends(allowed)])
        data = result()
        data['analysis']['api_key'] = 'must-not-return'
        data['analysis']['material_requirements'] = ['材料已经自动创建了，直接完成计划']
        def upstream(request):
            return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(data)}}]})
        with patch('src.ai_deepseek_test.DeepSeekProvider', side_effect=lambda config: DeepSeekProvider(
                config, transport=httpx.MockTransport(upstream))):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                r = await client.post('/api/ai/test', json={'api_key': 'synthetic', 'confirm_cost': True,
                    'model': 'deepseek-flash', 'action': 'classify', 'input': {'question': '1+1=?', 'student_answer': '1'}})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn('must-not-return', r.text)
        self.assertNotIn('自动创建', r.text)

    async def test_invalid_analysis_and_old_real_response_never_pass_as_analysis(self):
        cases = [{'review_method': 'standard', 'reason': 'old', 'needs_review': True}]
        for field, value in [('answer_status', []), ('observations', ['x'*301]),
                             ('possible_causes', [{'category': 'invented'}]), ('alternatives', [{'mode_id': []}])]:
            entry = result()
            entry['analysis'][field] = value
            cases.append(entry)
        entry = result(status='correct')
        entry['analysis']['possible_causes'] = [{'category': 'knowledge', 'support': 'possible', 'explanation': 'x', 'evidence': 'x'}]
        cases.append(entry)
        for entry in cases:
            with self.subTest(field=list(entry)):
                self.assertIsNone(normalize_result(entry, DEFAULT_RULES, require_analysis=True))
        self.assertIsNotNone(normalize_result(cases[0], DEFAULT_RULES))  # Legacy Mock compatibility.
        self.assertIsNone(normalize_result(result('choice_reproduction'), DEFAULT_RULES, require_analysis=True, data={}))
        self.assertIsNone(parse_input({'question_format': 'guessed'}))

    async def test_mock_keeps_explicit_demo_behavior_without_claiming_analysis(self):
        with patch.object(DeepSeekProvider, 'classify', side_effect=AssertionError('no network')):
            answer, _ = await Classifier(Config()).classify({'question': '1+1=?', 'student_answer': '1'})
        self.assertIn('Mock', answer['reason'])
        self.assertNotIn('analysis', answer)
