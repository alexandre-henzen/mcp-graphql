FROM node:22-slim
RUN npm install -g graphql-to-mcp
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["graphql-to-mcp"]
