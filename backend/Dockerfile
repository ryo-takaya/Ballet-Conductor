# API の開発用イメージ。Node / npm はホストに入れず、このコンテナの中だけで使う。
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 8787

CMD ["npm", "run", "dev"]
