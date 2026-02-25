FROM node:20-slim

# Install system dependencies for whatsapp-web.js (Puppeteer/Chromium)
RUN apt-get update && apt-get install -y \
    chromium \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --legacy-peer-deps

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Create required directories
RUN mkdir -p store workspace/uploads

# Environment for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

VOLUME ["/app/store", "/app/workspace"]

CMD ["node", "dist/index.js"]
