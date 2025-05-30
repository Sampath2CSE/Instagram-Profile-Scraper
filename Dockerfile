# Use official Apify base image with Node.js and Chrome
FROM apify/actor-node-puppeteer-chrome:20

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . ./

# Set the command to run the actor
CMD npm start