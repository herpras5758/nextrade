# Ship-X v2 — Deploy Guide

## Prerequisites
- Existing AWS infrastructure (ECS, RDS, S3, Cognito) from v1
- CloudShell access to ap-southeast-3

---

## Step 1: Upload Ship-X v2 files to CloudShell

Upload the ship-x-v2-foundation.tar.gz to CloudShell, then:
```bash
cd ~/nextrade-backend
tar -xzf ~/ship-x-v2-foundation.tar.gz
chmod +x ~/nextrade-backend/ship-x-v2/build-lambda.sh
chmod +x ~/nextrade-backend/ship-x-v2/setup-s3-notification.sh
```

---

## Step 2: Create SQS Queues

```bash
aws sqs create-queue --queue-name ship-x-classify-extract \
  --attributes VisibilityTimeout=900 \
  --region ap-southeast-3 --no-cli-pager

aws sqs create-queue --queue-name ship-x-resolution-engine \
  --attributes VisibilityTimeout=360 \
  --region ap-southeast-3 --no-cli-pager

aws sqs create-queue --queue-name ship-x-classify-dlq \
  --region ap-southeast-3 --no-cli-pager

aws sqs create-queue --queue-name ship-x-resolution-dlq \
  --region ap-southeast-3 --no-cli-pager
```

---

## Step 3: Create Lambda functions

Get existing Lambda role (reuse from v1):
```bash
ROLE_ARN=$(aws lambda get-function \
  --function-name nextrade-trigger-pipeline \
  --region ap-southeast-3 \
  --query "Configuration.Role" --output text --no-cli-pager)
echo $ROLE_ARN

DB_SECRET=$(aws lambda get-function-configuration \
  --function-name nextrade-trigger-pipeline \
  --region ap-southeast-3 \
  --query "Environment.Variables.DB_SECRET_ARN" --output text --no-cli-pager)
echo $DB_SECRET

BUCKET=$(aws lambda get-function-configuration \
  --function-name nextrade-trigger-pipeline \
  --region ap-southeast-3 \
  --query "Environment.Variables.DOCUMENTS_BUCKET_NAME" --output text --no-cli-pager)
echo $BUCKET

POOL_ID=ap-southeast-3_fMLPOFLn6
CLASSIFY_QUEUE=$(aws sqs get-queue-url --queue-name ship-x-classify-extract --region ap-southeast-3 --query QueueUrl --output text --no-cli-pager)
RESOLUTION_QUEUE=$(aws sqs get-queue-url --queue-name ship-x-resolution-engine --region ap-southeast-3 --query QueueUrl --output text --no-cli-pager)
```

Create placeholder zip:
```bash
echo "exports.handler=async()=>({success:true})" > /tmp/placeholder.js
zip -j /tmp/placeholder.zip /tmp/placeholder.js
```

Create all 4 Lambda functions:
```bash
for FUNC in classify-extract resolution-engine apply-schema seed-data; do
  aws lambda create-function \
    --function-name ship-x-${FUNC} \
    --runtime nodejs20.x \
    --role $ROLE_ARN \
    --handler index.handler \
    --zip-file fileb:///tmp/placeholder.zip \
    --timeout 300 \
    --memory-size 1024 \
    --environment "Variables={DB_SECRET_ARN=${DB_SECRET},DOCUMENTS_BUCKET_NAME=${BUCKET},CLASSIFY_EXTRACT_QUEUE_URL=${CLASSIFY_QUEUE},RESOLUTION_QUEUE_URL=${RESOLUTION_QUEUE},USER_POOL_ID=${POOL_ID}}" \
    --region ap-southeast-3 --no-cli-pager && echo "✅ ship-x-${FUNC} created"
done

# Resolution engine + apply-schema + seed-data need less memory
aws lambda update-function-configuration --function-name ship-x-resolution-engine --memory-size 512 --region ap-southeast-3 --no-cli-pager
aws lambda update-function-configuration --function-name ship-x-apply-schema --memory-size 256 --region ap-southeast-3 --no-cli-pager
aws lambda update-function-configuration --function-name ship-x-seed-data --memory-size 256 --region ap-southeast-3 --no-cli-pager
```

---

## Step 4: Add SQS triggers to Lambda

```bash
CLASSIFY_QUEUE_ARN=$(aws sqs get-queue-attributes \
  --queue-url $CLASSIFY_QUEUE \
  --attribute-names QueueArn --region ap-southeast-3 \
  --query Attributes.QueueArn --output text --no-cli-pager)

RESOLUTION_QUEUE_ARN=$(aws sqs get-queue-attributes \
  --queue-url $RESOLUTION_QUEUE \
  --attribute-names QueueArn --region ap-southeast-3 \
  --query Attributes.QueueArn --output text --no-cli-pager)

aws lambda create-event-source-mapping \
  --function-name ship-x-classify-extract \
  --event-source-arn $CLASSIFY_QUEUE_ARN \
  --batch-size 1 \
  --region ap-southeast-3 --no-cli-pager

aws lambda create-event-source-mapping \
  --function-name ship-x-resolution-engine \
  --event-source-arn $RESOLUTION_QUEUE_ARN \
  --batch-size 5 \
  --region ap-southeast-3 --no-cli-pager
```

---

## Step 5: Build and deploy Lambda code

```bash
cd ~
cp -r nextrade-backend/ship-x-v2 .
bash ~/ship-x-v2/build-lambda.sh classify-extract
bash ~/ship-x-v2/build-lambda.sh resolution-engine
bash ~/ship-x-v2/build-lambda.sh apply-schema
bash ~/ship-x-v2/build-lambda.sh seed-data
```

---

## Step 6: Apply schema

```bash
aws lambda invoke \
  --function-name ship-x-apply-schema \
  --region ap-southeast-3 --no-cli-pager /tmp/schema.json && cat /tmp/schema.json
```

---

## Step 7: Seed data

```bash
aws lambda invoke \
  --function-name ship-x-seed-data \
  --region ap-southeast-3 --no-cli-pager /tmp/seed.json && cat /tmp/seed.json
```

Note the tenantId from output. Update Cognito:
```bash
TENANT_ID="<tenantId from seed output>"
aws cognito-idp admin-update-user-attributes \
  --user-pool-id ap-southeast-3_fMLPOFLn6 \
  --username admin@ungaransari.test \
  --user-attributes Name="custom:tenant_ids",Value="${TENANT_ID}" \
  --region ap-southeast-3
```

---

## Step 8: Setup S3 notification

```bash
bash ~/ship-x-v2/setup-s3-notification.sh
```

---

## Step 9: Deploy API (ECS)

The Ship-X v2 API replaces the v1 API. Copy routes to ECS repo:
```bash
cp -r ~/ship-x-v2/api/src/routes/* ~/nextrade-backend/api/src/routes/
cp ~/ship-x-v2/api/src/lib/db.ts ~/nextrade-backend/api/src/lib/
cp ~/ship-x-v2/api/src/middleware/auth.ts ~/nextrade-backend/api/src/middleware/
cp ~/ship-x-v2/api/src/server.ts ~/nextrade-backend/api/src/

cd ~/nextrade-backend
git add -A
git commit -m "Ship-X v2: complete rewrite — knowledge graph, resolution engine, clean upload"
git push origin main
```

GitHub Actions will build and deploy ECS automatically.

---

## Step 10: Deploy Frontend

```bash
cp ~/ship-x-v2/frontend/src/App.tsx ~/nextrade-backend/nextrade-frontend/src/App.tsx
cp ~/ship-x-v2/frontend/src/main.tsx ~/nextrade-backend/nextrade-frontend/src/main.tsx

cd ~/nextrade-backend
git add -A
git commit -m "Ship-X v2: new frontend — Upload, Document Registry, Resolutions"
git push origin main
```

GitHub Actions will build and deploy to S3/CloudFront automatically.

---

## Step 11: Verify

1. Open CloudFront URL → Login
2. Settings → AI Engine → set Anthropic key → Save
3. Upload → Drop a PDF → watch status change
4. Documents → see document appear with status progressing
5. Resolutions → see resolution form automatically
6. Resolutions → Select → Approve → Shipment created

---

## Monitoring

```bash
# Watch classify-extract
aws logs tail /aws/lambda/ship-x-classify-extract \
  --region ap-southeast-3 --follow

# Watch resolution engine
aws logs tail /aws/lambda/ship-x-resolution-engine \
  --region ap-southeast-3 --follow
```

---

## Rollback (if needed)

v1 Lambdas still exist as `nextrade-*`. They are untouched.
Ship-X v2 uses separate `ship-x-*` Lambda names and new schema tables.
Both can coexist in the same DB (different table names).
