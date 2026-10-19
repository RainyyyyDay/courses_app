"""Development harness only; no database/login. Always mock, loopback clients only."""
from fastapi import Depends, FastAPI, HTTPException, Request
from src.ai_mistake import Config, register

app = FastAPI()


async def local_only(request: Request):
    host = request.headers.get("host", "").split(":", 1)[0]
    if (request.client is None or request.client.host not in {"127.0.0.1", "::1"} or
            host not in {"127.0.0.1", "localhost"} or request.headers.get("origin") or
            request.headers.get("x-forwarded-for")):
        raise HTTPException(status_code=403, detail="LOCAL_ONLY")


# Explicit Config() ignores all process model settings and keys in this harness.
register(app, dependencies=[Depends(local_only)], config=Config())
