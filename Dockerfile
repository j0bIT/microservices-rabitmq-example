FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY services ./services

CMD ["node", "services/${SERVICE_NAME}/index.js"]