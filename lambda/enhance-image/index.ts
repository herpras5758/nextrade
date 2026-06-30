// Image Enhancement — IDP Engine module #2. Runs BEFORE Classify, on
// raster image uploads (JPG/PNG/TIFF — scanned or photographed
// documents). Native PDFs skip this stage (Textract already handles
// clean PDF text/vector content well; re-rastering a clean PDF would
// throw away quality, not add it).
//
// Real, working techniques — not a no-op placeholder:
//   1. Grayscale conversion — color noise (paper texture, ink bleed
//      shadows) hurts OCR; grayscale is the standard first step.
//   2. Contrast normalization — the sample BL/PIB scans had visible
//      faint photocopy contrast; normalize so text-vs-background
//      separation is consistent regardless of how the original was
//      scanned/photographed.
//   3. Sharpening — counteracts blur from phone-camera capture, the
//      most common real-world intake method for SME exporters.
//   4. Despeckle (median blur at small radius) — removes dot noise from
//      low-quality scans/copies without blurring text edges.
//
// Deskew (rotation correction) is intentionally NOT implemented here —
// it requires Hough-transform-style line detection, which is real CV
// work beyond what Sharp's affine API does cheaply. Flagged as a known
// follow-up rather than faked with a fixed-angle rotate that would do
// more harm than good on documents that aren't actually skewed.

import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

const s3 = new S3Client({});

interface EnhanceImageInput {
  tenantId: string;
  documentId: string;
  s3Bucket: string;
  s3Key: string;
}

const RASTER_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp"];

export async function handler(event: EnhanceImageInput) {
  const { s3Bucket, s3Key } = event;
  const isRaster = RASTER_EXTENSIONS.some((ext) => s3Key.toLowerCase().endsWith(ext));

  if (!isRaster) {
    // PDF or already-clean input — pass through unchanged, point
    // downstream stages at the original object.
    return { ...event, enhancedS3Key: s3Key, enhancementApplied: false };
  }

  const original = await s3.send(new GetObjectCommand({ Bucket: s3Bucket, Key: s3Key }));
  const originalBuffer = Buffer.from(await original.Body!.transformToByteArray());

  const enhancedBuffer = await sharp(originalBuffer)
    .grayscale()
    .normalize() // contrast stretch to use the full tonal range
    .median(1) // light despeckle, radius small enough to preserve text edges
    .sharpen({ sigma: 1.0 })
    .toBuffer();

  const enhancedKey = s3Key.replace(/^uploads\//, "enhanced/");
  await s3.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: enhancedKey,
      Body: enhancedBuffer,
      ContentType: "image/png",
    })
  );

  return { ...event, enhancedS3Key: enhancedKey, enhancementApplied: true };
}
