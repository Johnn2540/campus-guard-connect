#!/bin/bash
# .render-build.sh

echo "🚀 Starting Render build process..."

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate deploy

echo "✅ Build completed successfully"