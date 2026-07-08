FROM node:22-alpine

RUN apk add --no-cache python3 make g++
RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/sdk ./packages/sdk
COPY packages/tee ./packages/tee

RUN pnpm install --frozen-lockfile

# Build SDK — use tsc for declarations since tsup DTS fails in Alpine
RUN cd packages/sdk && \
    npx tsup src/index.ts --format esm,cjs --no-dts --clean && \
    npx tsc -p tsconfig.json --declaration --emitDeclarationOnly --outDir dist 2>/dev/null || true

# Build NestJS TEE service
RUN cd packages/tee && npx tsc --skipLibCheck -p tsconfig.json

EXPOSE 3000

CMD ["node", "packages/tee/dist/main.js"]
