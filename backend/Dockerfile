FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.7.1 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r requirements.txt
COPY freetune_analysis ./freetune_analysis
COPY licenses ./licenses
ENV FREETUNE_DATA_DIR=/data
EXPOSE 8765
CMD ["python", "-m", "freetune_analysis", "--host", "0.0.0.0", "--port", "8765"]
