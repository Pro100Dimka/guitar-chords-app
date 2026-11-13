FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 freetune \
    && useradd --uid 10001 --gid 10001 --create-home freetune \
    && mkdir -p /data/tmp /models /cache/numba /cache/matplotlib /cache/huggingface \
    && chown -R 10001:10001 /data /models /cache
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY freetune_analysis ./freetune_analysis
COPY licenses ./licenses
ENV FREETUNE_DATA_DIR=/data \
    FREETUNE_SERVICE_MODE=shared \
    FREETUNE_WHISPER_MODEL=small \
    FREETUNE_WHISPER_PATH=/models/whisper-small \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HOME=/cache/huggingface \
    XDG_CACHE_HOME=/cache \
    NUMBA_CACHE_DIR=/cache/numba \
    MPLCONFIGDIR=/cache/matplotlib \
    TMPDIR=/data/tmp \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
USER 10001:10001
EXPOSE 8765
CMD ["python", "-m", "freetune_analysis", "--host", "0.0.0.0", "--port", "8765"]
