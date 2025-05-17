FROM node:20-alpine

WORKDIR /usr/src/app

# Copiază package.json și package-lock.json (dacă există)
COPY package*.json ./

# Instalează dependințele de producție
# Folosește npm ci --only=production dacă ai un package-lock.json consistent
RUN npm install --omit=dev

# Copiază codul sursă al aplicației
# Acest lucru include index.js și company_service.proto
COPY . .

# Expune porturile pe care aplicația ascultă ÎN INTERIORUL containerului
# Acestea vor fi mapate la porturile gazdei în docker-compose.yml
# Asigură-te că acestea se potrivesc cu porturile configurate prin variabilele de mediu
# sau cu valorile implicite din cod (MS1_HTTP_PORT, MS1_GRPC_PORT)
EXPOSE 3001
EXPOSE 50051

# Comanda pentru a porni aplicația
CMD [ "npm", "start" ]
