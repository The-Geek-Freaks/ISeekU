FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --production

COPY server.js frame-parser.js ./

# Run as a non-root user.
USER node

EXPOSE 5280

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:5280/health || exit 1

CMD ["node", "server.js"]
