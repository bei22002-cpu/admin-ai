"""MCP API Test Command - Auto-discover and test API endpoints."""

import json
import time

import httpx


async def _test_endpoint(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    body: dict | None = None,
    headers: dict | None = None,
) -> dict:
    """Test a single API endpoint."""
    start = time.time()
    try:
        kwargs: dict = {"headers": headers or {}}
        if body:
            kwargs["json"] = body
            kwargs["headers"]["Content-Type"] = "application/json"

        response = await getattr(client, method.lower())(url, **kwargs)
        elapsed = round((time.time() - start) * 1000, 1)

        try:
            resp_body = response.json()
        except Exception:
            resp_body = response.text[:500]

        return {
            "method": method.upper(),
            "url": url,
            "status_code": response.status_code,
            "response_time_ms": elapsed,
            "response_body": resp_body,
            "passed": 200 <= response.status_code < 400,
        }
    except httpx.ConnectError:
        return {
            "method": method.upper(),
            "url": url,
            "status_code": 0,
            "response_time_ms": round((time.time() - start) * 1000, 1),
            "error": "Connection refused",
            "passed": False,
        }
    except Exception as e:
        return {
            "method": method.upper(),
            "url": url,
            "status_code": 0,
            "response_time_ms": round((time.time() - start) * 1000, 1),
            "error": str(e)[:200],
            "passed": False,
        }


async def _discover_openapi(client: httpx.AsyncClient, base_url: str) -> list[dict]:
    """Try to discover endpoints via OpenAPI/Swagger spec."""
    endpoints = []
    spec_paths = ["/openapi.json", "/swagger.json", "/docs", "/api-docs"]

    for path in spec_paths:
        try:
            resp = await client.get(f"{base_url}{path}")
            if resp.status_code == 200:
                try:
                    spec = resp.json()
                    if "paths" in spec:
                        for route, methods in spec["paths"].items():
                            for method in methods:
                                if method.upper() in {"GET", "POST", "PUT", "DELETE", "PATCH"}:
                                    info = methods[method]
                                    endpoints.append({
                                        "method": method.upper(),
                                        "path": route,
                                        "summary": info.get("summary", ""),
                                    })
                        return endpoints
                except (json.JSONDecodeError, KeyError):
                    continue
        except Exception:
            continue
    return endpoints


async def handle_apitest(args: str) -> dict:
    """Handle 'MCP apitest [url]' command.

    Auto-discovers and tests API endpoints.
    """
    if not args:
        return {
            "message": "API test protocol requires a target URL. Usage: MCP apitest [base_url]",
            "data": {
                "status": "awaiting_input",
                "examples": [
                    "MCP apitest http://localhost:8000",
                    "MCP apitest http://localhost:3000/api",
                    "MCP apitest https://api.example.com",
                ],
            },
        }

    base_url = args.strip().rstrip("/")
    if not base_url.startswith("http"):
        base_url = f"http://{base_url}"

    results = []
    total_time = 0
    passed = 0
    failed = 0

    async with httpx.AsyncClient(timeout=15.0) as client:
        # Step 1: Try OpenAPI discovery
        discovered = await _discover_openapi(client, base_url)

        if discovered:
            # Test discovered endpoints
            for ep in discovered[:20]:
                url = f"{base_url}{ep['path']}"
                # Skip endpoints with path parameters for auto-testing
                if "{" in ep["path"]:
                    results.append({
                        "method": ep["method"],
                        "url": url,
                        "status_code": -1,
                        "skipped": True,
                        "reason": "Path parameters required",
                        "passed": None,
                    })
                    continue

                result = await _test_endpoint(client, ep["method"], url)
                result["summary"] = ep.get("summary", "")
                results.append(result)
                total_time += result.get("response_time_ms", 0)
                if result["passed"]:
                    passed += 1
                else:
                    failed += 1
        else:
            # Step 2: Probe common endpoints
            common_paths = [
                ("GET", "/"),
                ("GET", "/health"),
                ("GET", "/api"),
                ("GET", "/api/v1"),
                ("GET", "/status"),
                ("GET", "/ping"),
                ("GET", "/version"),
                ("GET", "/docs"),
                ("GET", "/openapi.json"),
            ]

            for method, path in common_paths:
                url = f"{base_url}{path}"
                result = await _test_endpoint(client, method, url)
                results.append(result)
                total_time += result.get("response_time_ms", 0)
                if result["passed"]:
                    passed += 1
                elif result.get("status_code", 0) > 0:
                    failed += 1

    total_tested = passed + failed
    avg_time = round(total_time / max(total_tested, 1), 1)

    return {
        "message": (
            f"API test complete for {base_url}. "
            f"{passed}/{total_tested} passed, avg response: {avg_time}ms"
        ),
        "data": {
            "status": "success" if failed == 0 and passed > 0 else "partial" if passed > 0 else "error",
            "base_url": base_url,
            "endpoints_discovered": len(discovered) if discovered else 0,
            "endpoints_tested": total_tested,
            "passed": passed,
            "failed": failed,
            "avg_response_ms": avg_time,
            "results": results[:20],
        },
    }
