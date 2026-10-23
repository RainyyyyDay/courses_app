"""Shared request configuration and DNS-pinned public HTTPS endpoints."""
from dataclasses import replace
import asyncio
import ipaddress
import re
import socket
from urllib.parse import urlsplit, urlunsplit


def endpoint(value):
    from .ai_mistake import AIError
    try:
        if not isinstance(value, str) or len(value)>2048 or any(ord(c)<=32 or ord(c)>126 for c in value) or "\\" in value:
            raise ValueError()
        u=urlsplit(value)
        if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.port not in (None,443):
            raise ValueError()
        host=u.hostname.lower()
        if host=='localhost' or host.endswith(('.localhost','.local','.internal')) or '%' in host:
            raise ValueError()
        try:
            if not ipaddress.ip_address(host).is_global:raise ValueError()
        except ValueError:
            # Distinguish invalid/domain names from non-public IP literals.
            if ':' in host or re.fullmatch(r'[0-9.]+',host):raise ValueError()
        path=u.path.rstrip('/')
        if not path.endswith('/chat/completions'):path+='/chat/completions'
        return urlunsplit(('https',u.netloc,path,'',''))
    except (ValueError,TypeError):
        raise AIError(400,'INVALID_API_URL') from None


async def public_target(value):
    from .ai_mistake import AIError
    import httpx
    url=httpx.URL(endpoint(value))
    try:
        addresses=await asyncio.to_thread(socket.getaddrinfo,url.host,443,type=socket.SOCK_STREAM)
        ips=list(dict.fromkeys(x[4][0] for x in addresses))
        if any(ipaddress.ip_address(x) in ipaddress.ip_network('198.18.0.0/15') for x in ips if ':' not in x):
            raise AIError(400,'AI_DNS_FAKE_IP')
        if not ips or any(not ipaddress.ip_address(x).is_global for x in ips):
            raise AIError(400,'INVALID_API_URL')
    except (OSError,ValueError):
        raise AIError(502,'AI_UNAVAILABLE') from None
    # The connection uses this validated IP; TLS still verifies the original hostname.
    return url.copy_with(host=ips[0]), {'Host':url.netloc.decode()}, {'sni_hostname':url.host}


def request_config(body, *, default_provider='deepseek', config_factory=None):
    from .ai_mistake import AIError, Config
    provider=body.get('provider',default_provider)
    if provider not in ('deepseek','compatible'):raise AIError(400,'INVALID_INPUT')
    key=body.get('api_key')
    if not isinstance(key,str) or not re.fullmatch(r'[\x21-\x7e]{1,512}',key):raise AIError(400,'INVALID_API_KEY')
    if body.get('confirm_cost') is not True:raise AIError(400,'COST_CONFIRMATION_REQUIRED')
    model=body.get('model')
    if not isinstance(model,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}',model):raise AIError(400,'INVALID_INPUT')
    if provider=='deepseek' and (model not in ('deepseek-flash','deepseek-v4-pro') or body.get('base_url')):raise AIError(400,'INVALID_INPUT')
    validated_base=endpoint(body.get('base_url')) if provider=='compatible' else ''
    workspace=body.get('workspace_id','')
    if not isinstance(workspace,str) or workspace and not re.fullmatch(r'[A-Za-z0-9_-]{1,128}',workspace):raise AIError(400,'INVALID_INPUT')
    if workspace and (provider!='compatible' or urlsplit(validated_base).hostname!='api.anthropic.com'):raise AIError(400,'INVALID_INPUT')
    config = (config_factory or Config)(**({'workspace_id':workspace} if workspace else {}),provider=provider,api_key=key,model=model,base_url=validated_base)

    return replace(config, timeout_ms=90000) if config_factory is None or config_factory is Config else config


def upstream_failure(status, payload):
    """Expose only status and known numeric business codes, never upstream prose."""
    from .ai_mistake import AIError
    error=payload.get('error') if isinstance(payload,dict) else None
    raw=error.get('code') if isinstance(error,dict) else None
    business=str(raw) if isinstance(raw,(str,int)) and re.fullmatch(r'[0-9]{1,8}',str(raw)) else None
    mapping={'1000':'AI_AUTH_FAILED','1001':'AI_AUTH_FAILED','1003':'AI_AUTH_FAILED',
             '1113':'AI_BALANCE_UNAVAILABLE','1211':'AI_MODEL_NOT_FOUND','1220':'AI_MODEL_PERMISSION',
             '1221':'AI_ENDPOINT_NOT_FOUND','1222':'AI_ENDPOINT_NOT_FOUND','1311':'AI_MODEL_PERMISSION',
             '1315':'AI_KEY_PRODUCT_MISMATCH','1210':'AI_REQUEST_REJECTED','1212':'AI_REQUEST_REJECTED',
             '1213':'AI_REQUEST_REJECTED','1214':'AI_REQUEST_REJECTED','1215':'AI_REQUEST_REJECTED',
             '1301':'AI_CONTENT_REJECTED'}
    known={'invalid_api_key':'AI_AUTH_FAILED','authentication_error':'AI_AUTH_FAILED',
           'permission_error':'AI_MODEL_PERMISSION','model_not_found':'AI_MODEL_NOT_FOUND',
           'insufficient_quota':'AI_BALANCE_UNAVAILABLE','billing_hard_limit_reached':'AI_BALANCE_UNAVAILABLE',
           'invalid_request_error':'AI_REQUEST_REJECTED','context_length_exceeded':'AI_REQUEST_REJECTED',
           'rate_limit_error':'AI_UPSTREAM_RATE_LIMITED','overloaded_error':'AI_UPSTREAM_ERROR'}
    symbolic=known.get(raw) if isinstance(raw,str) else None
    if not symbolic and isinstance(error,dict):symbolic=known.get(error.get('type')) if isinstance(error.get('type'),str) else None
    code=mapping.get(business) or symbolic or {401:'AI_AUTH_FAILED',402:'AI_BALANCE_UNAVAILABLE',403:'AI_MODEL_PERMISSION',
                                  404:'AI_ENDPOINT_NOT_FOUND',429:'AI_UPSTREAM_RATE_LIMITED'}.get(status,'AI_REQUEST_REJECTED' if status==400 else 'AI_UPSTREAM_ERROR')
    details={}
    if 100<=status<=599:details['upstream_status']=status
    if business:details['upstream_code']=business
    return AIError(502,code,source='error',details=details)


def completion_options(config):
    """Provider-specific text/JSON parameters; unknown custom endpoints stay minimal."""
    host=urlsplit(config.base_url).hostname if config.base_url else ''
    model=config.model.lower()
    options={'max_tokens':8192 if model.startswith('glm-5.') else 1600}
    if config.provider=='deepseek' or host=='api.deepseek.com':
        return {**options,'thinking':{'type':'disabled'},'response_format':{'type':'json_object'}}
    if host=='open.bigmodel.cn' and model.startswith('glm-'):
        options['response_format']={'type':'json_object'}
    elif host in ('dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com') or host and host.endswith('.maas.aliyuncs.com'):
        options['max_tokens']=4096
        if model in ('qwen-plus','qwen-flash','qwen3.7-plus','qwen3.8-max','qwen3.8-flash'):
            options.update(enable_thinking=False,response_format={'type':'json_object'})
    elif host in ('api.moonshot.cn','api.moonshot.ai'):
        options.update(max_tokens=8192,response_format={'type':'json_object'})
        if model=='kimi-k3':options['reasoning_effort']='low'
    elif host=='ark.cn-beijing.volces.com':
        options['max_tokens']=4096
        if model.startswith('doubao-seed-2-'):
            options.update(thinking={'type':'disabled'},response_format={'type':'json_object'})
    elif host=='api.siliconflow.cn':
        options.update(max_tokens=4096,response_format={'type':'json_object'})
    if host=='api.openai.com':
        options={'max_completion_tokens':8192,'response_format':{'type':'json_object'}}
        if model.startswith(('gpt-5','gpt-6','o3','o4')):options['reasoning_effort']='low'
    elif host=='generativelanguage.googleapis.com':
        options={'max_tokens':8192,'response_format':{'type':'json_object'}}
        if model.startswith(('gemini-3','gemini-4')):options['reasoning_effort']='low'
    elif host=='api.anthropic.com':
        options={'max_tokens':8192}
    elif host=='api.x.ai':
        options={'max_tokens':8192,'response_format':{'type':'json_object'}}
    return options
