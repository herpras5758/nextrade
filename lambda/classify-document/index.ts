// Classify Document — first stage of the pipeline (Rule #10 adapter
// pattern: this is the only place that decides document_type; nothing
// downstream re-derives it from filename or guesses).
//
// Approach: classify from CONTENT (first-page text via lightweight
// Textract DetectDocumentText, not full AnalyzeDocument — classification
// doesn't need table/form structure, just enough text for Bedrock to
// recognize the document type), never from the uploaded filename. The
// sample shipment set (OBOR/Ungaran Sari Garments) made this concrete:
// filenames in real intake are inconsistent ("Maping_Digitalisasi_-_1.pdf"
// for a file containing 7 different document types across one PDF), so
// filename-based classification would have failed immediately.

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { invokeAIEngine, DEFAULT_AI_ENGINE_CONFIG } from "../ai-engine-adapter/index.js";

const s3 = new S3Client({});
const textract = new TextractClient({});

// Config-driven (Rule #4) — the set of document types this stage can
// recognize, mirrors the document names used in lib/bcTypes.ts on the
// frontend (Addendum B). Adding a new document type means adding one
// entry here, not new branching logic.
const KNOWN_DOCUMENT_TYPES = [
  "Commercial Invoice",
  "Packing List",
  "Purchase Order",
  "Bill of Lading / AWB",
  "Certificate of Origin",
  "Letter of Guarantee",
  "Inward Manifest BC 1.1",
  "BC 2.3 Declaration",
  "Surat Jalan",
] as const;

interface ClassifyInput {
  tenantId: string;
  documentId: string;
  s3Bucket: string;
  s3Key: string;
}

export async function handler(event: ClassifyInput) {
  const { s3Bucket, s3Key } = event;

  // Lightweight text extraction — just enough signal for classification,
  // not the full structured pass (that happens in Extract Fields once we
  // know what kind of document we're looking at, since table/form
  // extraction strategy differs per document type).
  const textractResult = await textract.send(
    new DetectDocumentTextCommand({
      Document: { S3Object: { Bucket: s3Bucket, Name: s3Key } },
    })
  );

  const pageText = (textractResult.Blocks ?? [])
    .filter((b) => b.BlockType === "LINE")
    .map((b) => b.Text)
    .join("\n")
    .slice(0, 3000); // first ~3000 chars is plenty for classification

  const aiResponse = await invokeAIEngine(
    {
      systemPrompt: `You classify Indonesian customs/trade documents. Respond with ONLY one value from this exact list, nothing else: ${KNOWN_DOCUMENT_TYPES.join(", ")}. If the text matches none of these, respond with "UNCLASSIFIED".`,
      userPrompt: `Classify this document based on its extracted text:\n\n${pageText}`,
      maxTokens: 50,
    },
    DEFAULT_AI_ENGINE_CONFIG
  );

  const documentType = aiResponse.text.trim();
  const isKnown = (KNOWN_DOCUMENT_TYPES as readonly string[]).includes(documentType);

  return {
    ...event,
    documentType: isKnown ? documentType : "UNCLASSIFIED",
    classificationConfidence: isKnown ? 0.9 : 0.3, // heuristic — Learning
    // Engine (Rule #9) refines this over time using actual correction
    // history rather than a fixed guess like this one.
  };
}
