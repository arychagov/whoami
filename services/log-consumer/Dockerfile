FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-fund --no-audit

COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "start"]

