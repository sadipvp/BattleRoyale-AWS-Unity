# Matchmaking Service Dockerfile
#
# Build context must be the REPO ROOT — same pattern as auth service.
# docker build -f services/matchmaking/Dockerfile -t matchmaking-service .

# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

COPY services/shared /shared
COPY services/matchmaking/requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim

RUN useradd --no-create-home --shell /bin/false appuser

# curl is needed for the container health check
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /root/.local /home/appuser/.local
COPY services/matchmaking/app ./app

USER appuser

ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
