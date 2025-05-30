# Use official Apify base image with Node.js, Chrome, and Playwright
FROM apify/actor-node-playwright-chrome:20

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install dependencies with optimizations
RUN npm install --omit=dev --no-audit --no-fund

# Copy source code
COPY . ./

# Set the command to run the actor
CMD npm start