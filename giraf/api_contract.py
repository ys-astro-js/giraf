"""HTTP envelope validation, local-origin protection, and consistent API errors."""
from typing import Any
from pydantic import TypeAdapter
from starlette.requests import Request
from starlette.responses import JSONResponse


# Validate the JSON envelope before endpoint code accesses it.
payload_adapter = TypeAdapter(dict[str, Any])


async def request_payload(request):
    return payload_adapter.validate_python(await request.json(), strict=True)


class LocalOriginMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] == 'http' and scope['method'] == 'POST' and scope['path'].startswith('/api/'):
            request = Request(scope)
            origin = request.headers.get('origin')
            if origin and origin != str(request.base_url).rstrip('/'):
                response = JSONResponse({'error': '허용하지 않는 요청 출처입니다.'}, status_code=403)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


async def validation_error(request, exc):
    issues = [
        {'field': '.'.join(str(part) for part in error['loc']) or 'inputs',
         'message': error['msg']}
        for error in exc.errors(include_url=False, include_context=False, include_input=False)
    ]
    return JSONResponse({'error': '입력 형식을 확인해 주세요.', 'issues': issues}, status_code=400)


async def api_error(request, exc):
    import re
    message = str(exc)
    match = re.search(r'(?:ccdproc\.)?([A-Za-z][\w]*)[:=]', message)
    field = match.group(1) if match else 'inputs'
    return JSONResponse({'error': message, 'issues': [{'field': field, 'message': message}]}, status_code=400)


async def http_error(request, exc):
    return JSONResponse({'error': str(exc.detail)}, status_code=exc.status_code, headers=exc.headers)


