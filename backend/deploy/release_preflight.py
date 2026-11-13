"""Read-only public HTTPS release gate for the FreeTune shared analysis service.

No registration, upload, paid API or deployment is performed.
Run after the operator has deployed the service, before inserting its URL into
src/config/analysis-service.json.
"""
import argparse
import ipaddress
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request


def validate_public_url(raw: str) -> str:
    parsed = urllib.parse.urlsplit(raw.strip())
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path not in ("", "/")):
        raise ValueError("Use a bare public HTTPS origin, without a path, credentials or query")
    hostname = parsed.hostname.rstrip(".")\n    if not hostname or hostname.endswith(".local") or hostname.endswith(".internal"):\n        raise ValueError("Use a public DNS hostname")
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise ValueError("The release endpoint cannot be localhost")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        if "." not in hostname:
            raise ValueError("Use a public DNS hostname")
    else:
        if not address.is_global:
            raise ValueError("The release endpoint cannot be a private or local IP address")
    return urllib.parse.urlunsplit(("https", parsed.netloc, "", "", ""))


def check_health(origin: str, timeout: float = 15.0) -> dict:
    request = urllib.request.Request(
        origin + "/health",
        headers={"Accept": "application/json", "User-Agent": "FreeTune-release-preflight/1"},
        method="GET",
    )
    # Default TLS context verifies chain and hostname. Never disable verification.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            raise ValueError("Public health endpoint must not redirect")

    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        NoRedirect(),
        urllib.request.ProxyHandler({}),
    )
    with opener.open(request, timeout=timeout) as response:
        if response.status != 200:
            raise ValueError(f"Unexpected health status: {response.status}")
        if response.headers.get_content_type() != "application/json":
            raise ValueError("Health response must be application/json")
        payload = response.read(65537)
        if len(payload) > 65536:
            raise ValueError("Health response exceeds 64 KiB")
    body = json.loads(payload)
    if not isinstance(body, dict):
        raise ValueError("Health response must be an object")
    expected = {"ready": True, "serviceMode": "shared", "authentication": "installation"}
    for field, value in expected.items():
        if body.get(field) != value:
            raise ValueError(f"Health {field} must be {value!r}; got {body.get(field)!r}")
    return body


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("origin", help="Public HTTPS origin to validate, e.g. https://analysis.example.org")
    parser.add_argument("--timeout", type=float, default=15)
    args = parser.parse_args(argv)
    try:
        if not 0 < args.timeout <= 120:
            raise ValueError("Timeout must be greater than zero and at most 120 seconds")
        origin = validate_public_url(args.origin)
        health = check_health(origin, args.timeout)
    except (ValueError, OSError, json.JSONDecodeError, urllib.error.URLError, ssl.SSLError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps({"ok": True, "origin": origin,
                      "serviceMode": health["serviceMode"],
                      "authentication": health["authentication"],
                      "ready": health["ready"]}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
