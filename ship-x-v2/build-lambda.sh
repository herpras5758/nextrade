#!/bin/bash
# Ship-X v2 Lambda build script
# Usage: ./build-lambda.sh <function-name>
# Function names: classify-extract | resolution-engine | apply-schema | seed-data

set -e
FUNC=${1:-classify-extract}
BUILD_DIR=/tmp/ship-x-build-$$
SRC_DIR=~/nextrade-backend/ship-x-v2

echo "🔨 Building ship-x-${FUNC}..."
mkdir -p $BUILD_DIR/lambda/$FUNC $BUILD_DIR/lambda/shared/graph

# Copy source files
cp $SRC_DIR/lambda/$FUNC/index.ts $BUILD_DIR/lambda/$FUNC/
cp $SRC_DIR/lambda/shared/dbPool.ts $BUILD_DIR/lambda/shared/
cp $SRC_DIR/lambda/shared/aiProvider.ts $BUILD_DIR/lambda/shared/

if [ -f "$SRC_DIR/lambda/shared/graph/graphWriter.ts" ]; then
  cp $SRC_DIR/lambda/shared/graph/graphWriter.ts $BUILD_DIR/lambda/shared/graph/
fi

# Copy schema for apply-schema
if [ "$FUNC" = "apply-schema" ]; then
  mkdir -p $BUILD_DIR/db
  cp $SRC_DIR/db/schema.sql $BUILD_DIR/db/
fi

# Install deps + build
cd $BUILD_DIR
npm init -y > /dev/null 2>&1
npm install pg pdf-lib esbuild @aws-sdk/client-s3 @aws-sdk/client-sqs \
  @aws-sdk/client-secrets-manager @aws-sdk/client-cognito-identity-provider \
  @aws-sdk/s3-request-presigner > /dev/null 2>&1

EXTRA_ARGS=""
if [ "$FUNC" = "apply-schema" ]; then
  EXTRA_ARGS="--loader:.sql=text"
fi

node_modules/.bin/esbuild lambda/$FUNC/index.ts \
  --bundle --platform=node --target=node20 \
  --external:@aws-sdk/* --format=cjs \
  $EXTRA_ARGS \
  --outfile=/tmp/ship-x-$FUNC.js

cp /tmp/ship-x-$FUNC.js /tmp/index.js
cd /tmp && zip -j ship-x-$FUNC.zip index.js > /dev/null

aws lambda update-function-code \
  --function-name ship-x-$FUNC \
  --zip-file fileb:///tmp/ship-x-$FUNC.zip \
  --region ap-southeast-3 --no-cli-pager > /dev/null

echo "✅ ship-x-${FUNC} deployed"
rm -rf $BUILD_DIR /tmp/ship-x-$FUNC.js /tmp/ship-x-$FUNC.zip /tmp/index.js
