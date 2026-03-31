FROM node:22-slim

# Install useful tools the bot's bash access may need
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl wget jq procps htop \
    python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.30.1 --activate

WORKDIR /app

# Install deps first (layer cache)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Persistent volumes for data, skills, and workspace
RUN mkdir -p /app/data /app/skills /app/workspace

ENV NODE_ENV=production
ENV DATA_DIR=/app/data
ENV SKILLS_DIR=/app/skills
ENV WORKSPACE_DIR=/app/workspace

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["pnpm", "start"]
