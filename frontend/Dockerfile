# Stage 1 - Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY . .

RUN npm install
RUN npm run build

# Stage 2 - Run
FROM node:20-alpine

WORKDIR /app

# Copiază întreaga aplicație din etapa de build
COPY --from=builder /app ./

# Instalează toate dependențele, inclusiv cele de dezvoltare
RUN npm install

# Expune portul pe care serverul va rula
EXPOSE 3000

# Rulează aplicația folosind scriptul preview
CMD ["npm", "run", "preview", "--", "--port", "3000", "--host"]