FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NEUROLENS_ENV=production \
    DATA_DIR=/data \
    HF_HOME=/data/hf-cache

WORKDIR /srv

COPY requirements.txt .
# CPU-only torch keeps the image far smaller than the default CUDA build.
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r requirements.txt

COPY app ./app

RUN useradd --system --uid 10001 --create-home neurolens && mkdir -p /data && chown neurolens /data
USER neurolens
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health').status==200 else 1)"

# One worker: the retrieval index and rate limiter are in-process. Scale out only after moving them to shared storage.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
