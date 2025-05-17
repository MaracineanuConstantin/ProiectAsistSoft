FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

EXPOSE 4500
ENV JWT_SECRET="123"

CMD [ "node", "index.js" ]