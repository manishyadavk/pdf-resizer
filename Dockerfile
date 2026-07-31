FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

RUN mkdir -p tmp/uploads tmp/output

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.js"]
