FROM node:22.22.0-alpine AS platform-admin-build

WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY platform-admin/index.html platform-admin/styles.css platform-admin/tsconfig.json ./platform-admin/
COPY platform-admin/src/api.ts platform-admin/src/auth.ts platform-admin/src/review.ts platform-admin/src/main.ts ./platform-admin/src/
COPY scripts/build-platform-admin.mjs ./scripts/build-platform-admin.mjs
RUN npm run build:platform-admin

FROM ghcr.io/astral-sh/uv:0.11.32-python3.13-trixie-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_NO_DEV=1

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY alembic.ini ./
COPY backend ./backend
COPY scripts ./scripts
COPY --from=platform-admin-build /build/platform-admin/dist ./platform-admin/dist
COPY deploy/venue-directory.json /app/deploy/venue-directory.json
COPY deploy/venue-directory.schema.json /app/deploy/venue-directory.schema.json

RUN groupadd --system pitch \
    && useradd --system --gid pitch --home-dir /app pitch \
    && chown -R pitch:pitch /app

USER pitch

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
