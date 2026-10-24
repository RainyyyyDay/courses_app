"""Mount the course AI JSON API inside an existing FastAPI application."""
from . import (ai_mistake, ai_deepseek_test, ai_answer_draft, ai_review_suggestion,
               ai_creation_review, ai_material_draft, ai_review_feedback,
               ai_outline, ai_assessment_chart, ai_platform)


def register(app, *, dependencies=None, status_dependencies=None):
    for module in (ai_mistake, ai_deepseek_test, ai_answer_draft, ai_review_suggestion,
                   ai_creation_review, ai_material_draft, ai_review_feedback,
                   ai_outline, ai_assessment_chart):
        module.register(app, dependencies=dependencies)
    ai_platform.register(app, dependencies=dependencies if status_dependencies is None else status_dependencies)
