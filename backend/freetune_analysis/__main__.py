import argparse
import os
import uvicorn

from .config import Settings


def main():
    parser = argparse.ArgumentParser(description="FreeTune audio analysis service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    settings = Settings.from_env()
    if settings.service_mode == "private" and args.host not in {"127.0.0.1", "localhost", "::1"} and not settings.token:
        parser.error("Set FREETUNE_API_TOKEN for a private server accepting remote connections.")
    os.umask(0o077)
    # Forwarded headers are interpreted only by our exact-proxy policy, never by Uvicorn.
    uvicorn.run("freetune_analysis.app:app", host=args.host, port=args.port, workers=1,
                proxy_headers=False, access_log=False, timeout_keep_alive=5)


if __name__ == "__main__":
    main()
