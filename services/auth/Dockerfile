# Auth Service Dockerfile
#
# Build context must be the REPO ROOT (not services/auth/) so we can COPY
# both services/shared/ and services/auth/ in the same build context.
#
# docker build -f services/auth/Dockerfile -t auth-service .
#   (note the trailing '.' — repo root as context)

# ── Stage 1: install dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Copy the shared package first — installed as a dependency of auth
COPY services/shared /shared

# Copy requirements and install into /root/.local for later copying
COPY services/auth/requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim

# Non-root user for security
RUN useradd --no-create-home --shell /bin/false appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /root/.local /home/appuser/.local

# Copy application source
COPY services/auth/app ./app

USER appuser

ENV PATH=/home/appuser/.local/bin:$PATH
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
