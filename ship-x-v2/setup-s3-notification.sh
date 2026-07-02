#!/bin/bash
# Setup S3 event notification → SQS (classify-extract)
# Run once after deploying the pipeline stack

set -e
REGION=${AWS_REGION:-ap-southeast-3}
ACCOUNT=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
BUCKET="nextrade-documents-${ACCOUNT}-${REGION}"
QUEUE_ARN=$(aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name ship-x-classify-extract --region $REGION --query QueueUrl --output text) \
  --attribute-names QueueArn --region $REGION --query Attributes.QueueArn --output text --no-cli-pager)

echo "Bucket: $BUCKET"
echo "Queue ARN: $QUEUE_ARN"

# Add permission for S3 to send to SQS
aws sqs set-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name ship-x-classify-extract --region $REGION --query QueueUrl --output text) \
  --attributes "{\"Policy\":\"{\\\"Version\\\":\\\"2012-10-17\\\",\\\"Statement\\\":[{\\\"Sid\\\":\\\"S3SendMessage\\\",\\\"Effect\\\":\\\"Allow\\\",\\\"Principal\\\":{\\\"Service\\\":\\\"s3.amazonaws.com\\\"},\\\"Action\\\":\\\"sqs:SendMessage\\\",\\\"Resource\\\":\\\"${QUEUE_ARN}\\\",\\\"Condition\\\":{\\\"ArnLike\\\":{\\\"aws:SourceArn\\\":\\\"arn:aws:s3:::${BUCKET}\\\"}}}]}\"}" \
  --region $REGION --no-cli-pager

# Set S3 event notification
aws s3api put-bucket-notification-configuration \
  --bucket $BUCKET \
  --region $REGION \
  --notification-configuration "{
    \"QueueConfigurations\": [
      {
        \"QueueArn\": \"${QUEUE_ARN}\",
        \"Events\": [\"s3:ObjectCreated:Put\", \"s3:ObjectCreated:CompleteMultipartUpload\"],
        \"Filter\": {
          \"Key\": {
            \"FilterRules\": [
              { \"Name\": \"prefix\", \"Value\": \"uploads/\" }
            ]
          }
        }
      }
    ]
  }"

echo "✅ S3 → SQS notification configured"
echo "Files uploaded to s3://${BUCKET}/uploads/ will trigger ship-x-classify-extract"
