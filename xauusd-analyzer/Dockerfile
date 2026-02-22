FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Build the Vite frontend application
RUN npm run build

# Expose the API and UI port
EXPOSE 8080

# Define environment variables (Port is dictated by Cloud Run)
ENV PORT=8080

# Start the application
CMD [ "node", "server.js" ]
