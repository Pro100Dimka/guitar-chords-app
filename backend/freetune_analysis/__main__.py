import argparse
import os
import uvicorn


def main():
    parser = argparse.ArgumentParser(description="FreeTune private audio analysis service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "localhost", "::1"} and not os.getenv("FREETUNE_API_TOKEN"):
        parser.error("Set FREETUNE_API_TOKEN before accepting connections from other devices.")
    uvicorn.run("freetune_analysis.app:app", host=args.host, port=args.port, workers=1)


if __name__ == "__main__":
    main()
