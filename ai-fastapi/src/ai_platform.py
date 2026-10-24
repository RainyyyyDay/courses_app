"""Server-owned AI configuration and a non-billable, authenticated capability route."""
import os
import re
from .ai_mistake import AIError, Config


def platform_config(env=None):
    env = os.environ if env is None else env
    if env.get('PLATFORM_AI_ENABLED') != 'true':
        raise AIError(503, 'PLATFORM_AI_UNAVAILABLE')
    try:
        provider = env.get('PLATFORM_AI_PROVIDER', 'deepseek')
        if provider not in ('deepseek', 'compatible'):
            raise ValueError()
        if not re.fullmatch(r'[\x21-\x7e]{1,512}', env.get('PLATFORM_AI_API_KEY', '')):
            raise ValueError()
        return Config(provider=provider, api_key=env.get('PLATFORM_AI_API_KEY', ''),
                      model=env.get('PLATFORM_AI_MODEL', 'deepseek-flash'),
                      base_url=env.get('PLATFORM_AI_BASE_URL', ''),
                      workspace_id=env.get('PLATFORM_AI_WORKSPACE_ID', ''), timeout_ms=90000)
    except (ValueError, TypeError, AIError):
        raise AIError(503, 'PLATFORM_AI_UNAVAILABLE') from None


def register(app, *, dependencies=None):
    from fastapi import APIRouter, Depends, HTTPException
    from fastapi.responses import JSONResponse
    if getattr(app.state, '_ai_platform_registered', False):
        raise ValueError('AI platform route already registered')

    async def deny():
        raise HTTPException(503, detail='AI_AUTH_NOT_CONFIGURED')

    router = APIRouter(dependencies=list(dependencies) if dependencies else [Depends(deny)])

    @router.get('/api/ai/platform-status')
    async def status():
        # Configuration readiness only: no model request, balance query or database access.
        try:
            config = platform_config()
            body = {'available': True, 'provider': 'platform', 'model': config.model}
        except AIError:
            body = {'available': False, 'provider': 'platform', 'error': 'PLATFORM_AI_UNAVAILABLE'}
        return JSONResponse(body, headers={'Cache-Control': 'no-store'})

    app.include_router(router)
    app.state._ai_platform_registered = True
    return router
