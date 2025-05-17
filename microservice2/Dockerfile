FROM node:20-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --omit=dev

# Copiază codul sursă, inclusiv company_service.proto
COPY . .

# Expune portul HTTP
# Asigură-te că acesta se potrivește cu MS2_HTTP_PORT
EXPOSE 3002

CMD [ "npm", "start" ]