FROM node:24-slim
WORKDIR /app
COPY server/package.json ./
RUN npm install --production
COPY server/ ./
COPY web/ ../web/
COPY analysis/ ../analysis/
EXPOSE 3360
CMD ["node", "index.mjs"]
