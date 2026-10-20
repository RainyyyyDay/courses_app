"""Synthetic contract fixtures, not evidence of a real model's educational quality."""
def result(mode='standard', status='incorrect'):
    return {'review_method': mode, 'reason': '先独立作答核对，再根据过程选择针对性练习。', 'needs_review': True,
            'analysis': {'answer_status': status, 'observations': ['根据题目和所填答案比较，仍需人工核对。'],
                         'possible_causes': [], 'follow_up_questions': ['请说明当时的计算或思考过程。'],
                         'reference_check': '所填参考答案仅是核对线索，应结合题意检查。', 'alternatives': []}}
