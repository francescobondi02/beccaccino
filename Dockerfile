FROM node:24-alpine3.21

WORKDIR /app

RUN apk update && apk upgrade

COPY . . 

RUN npm install
RUN npx prisma generate

CMD ["npm", "run", "dev"]