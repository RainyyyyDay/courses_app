"""Opt-in, transient official DeepSeek testing. No persistence or environment keys.

Host must supply authentication/permission dependencies; the local harness supplies
loopback protection instead. Never register the local harness in production.
"""
from .ai_provider import request_config
import time
from uuid import uuid4

from .ai_mistake import (AIError, Classifier, Config, DeepSeekProvider,
                         _read_body, _with_disconnect, parse_input)

PATH = '/api/ai/test'
MODELS = ('deepseek-flash', 'deepseek-v4-pro')
SAMPLE = {'question': '1+1=?', 'student_answer': '3', 'error_type': 'careless'}


def validate(body):
    if not isinstance(body, dict) or set(body) - {'provider', 'base_url', 'api_key', 'model', 'action', 'confirm_cost', 'input'}:
        raise AIError(400, 'INVALID_INPUT')
    if body.get('confirm_cost') is not True:
        raise AIError(400, 'COST_CONFIRMATION_REQUIRED')
    key = body.get('api_key')
    if not isinstance(key, str) or not 1 <= len(key) <= 512 or not all(33 <= ord(c) <= 126 for c in key):
        raise AIError(400, 'INVALID_API_KEY')
    model, action = body.get('model'), body.get('action')
    request_config(body)
    if action not in ('connection', 'classify'):
        raise AIError(400, 'INVALID_INPUT')
    data = SAMPLE.copy() if action == 'connection' else parse_input(body.get('input'))
    if data is None or not all(data.get(k) for k in ('question', 'student_answer')):
        raise AIError(400, 'INVALID_INPUT')
    return key, model, action, data



class ConnectionProvider:
    def __init__(self, delegate):
        self.delegate=delegate

    async def classify(self, data, rules):
        return await self.delegate.complete_json({'message':'connection test'},
            'This is a connection test. Reply with exactly one JSON object: {"connected":true}. Do not analyze questions or add explanations.')


class ConnectionRunner(Classifier):
    async def classify(self, data):
        return await self.run(data, lambda value: {'connected':True}
                              if isinstance(value,dict) and value.get('connected') is True else None)


def register(app, *, dependencies=None):
    """Register a JSON-only test endpoint; missing host authorization denies use.

    Shared per-worker limits span keys; per-request credentials never replace the
    application's environment config. Host owns shared user quotas and log redaction.
    """
    from fastapi import APIRouter, Depends, HTTPException, Request
    from fastapi.responses import JSONResponse

    if getattr(app.state, '_ai_deepseek_test_registered', False) or any(
            getattr(route, 'path', None) == PATH for route in app.routes):
        raise ValueError('AI test route already registered')

    async def deny():
        raise HTTPException(503, detail='AI_AUTH_NOT_CONFIGURED')

    router = APIRouter(dependencies=list(dependencies) if dependencies else [Depends(deny)])
    gate = Classifier(Config(rate_max=10, max_concurrent=2))

    @router.post(PATH)
    async def test(request: Request):
        headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
                   'X-Request-ID': str(uuid4()), 'X-AI-Provider': 'deepseek'}
        body = None
        try:
            gate.check_rate()
            body = await _read_body(request)
            key, model, action, data = validate(body)
            config = request_config(body, config_factory=Config)
            headers['X-AI-Provider'] = config.provider
            delegate=DeepSeekProvider(config)
            classifier = ConnectionRunner(config, provider=ConnectionProvider(delegate)) if config.provider=='compatible' and action=='connection' else Classifier(config, provider=delegate)
            # Reuse the existing cancellation-safe task pool, across all credentials.
            classifier.tasks = gate.tasks
            started = time.monotonic()
            result, source = await _with_disconnect(request, classifier, data)
            headers['X-AI-Result-Source'] = source
            # A structurally invalid model answer is not a successful test.
            if source != 'provider':
                raise AIError(502, 'INVALID_RESPONSE')
            return JSONResponse({'ok': True, 'provider': config.provider, 'model': model,
                                 'action': action, 'elapsed_ms': round((time.monotonic()-started)*1000),
                                 **({'result': result} if action == 'classify' else {})}, headers=headers)
        except Exception as exc:
            failure = exc if isinstance(exc, AIError) else AIError(500, 'INTERNAL_ERROR')
            if failure.retry_after is not None:
                headers['Retry-After'] = str(failure.retry_after)
            return JSONResponse({'error': failure.code, **failure.details}, status_code=failure.status, headers=headers)
        finally:
            if isinstance(body, dict):
                body.pop('api_key', None)
            # This is not a claim of secure memory erasure; no credential is persisted.

    app.include_router(router)
    app.state._ai_deepseek_test_registered = True
    return router
