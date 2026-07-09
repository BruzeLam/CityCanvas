FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_PATH=/data/citycanvas.db

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000

CMD ["npm", "start"]
