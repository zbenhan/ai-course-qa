FROM node:22-alpine

WORKDIR /app

# 本项目零依赖，不需要 npm install，直接拷贝源码即可
COPY src ./src
COPY package.json ./

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "src/index.js"]
