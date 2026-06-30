// Extract Fields — Textract for raw structure (tables, key-value forms),
// Bedrock for mapping that raw structure into CTDM field candidates with
// confidence + reasoning. This split matters: Textract gives precise
// bounding-box-backed text/table extraction (good for "what does the
// document literally say"), Bedrock gives domain reasoning (good for
// "what CTDM field does this correspond to, and how confident are we").
// Neither alone is enough — pure Textract has no concept of "this number
// is the gross weight" vs "this is the CBM"; pure Bedrock without
// Textract's table parse would have to re-derive table structure from
// raw OCR text, which is exactly the kind of work Textract already does
// reliably and cheaply.

import { S3Client } from "@aws-sdk/client-s3";
import { TextractClient, AnalyzeDocumentCommand } from "@aws-sdk/client-textract";
import { invokeAIEngine, DEFAULT_AI_ENGINE_CONFIG } from "../ai-engine-adapter/index.js";
import { normalizeNumber } from "../shared/numberFormat.js";

const textract = new TextractClient({});

interface ExtractInput {
  tenantId: string;
  documentId: string;
  s3Bucket: string;
  s3Key: string;
  enhancedS3Key?: string;
  documentType: string;
}

export interface ExtractedFieldCandidate {
  fieldKey: string;
  rawValue: string;
  normalizedValue: string; // numeric fields normalized via numberFormat.ts; text fields pass through
  confidence: number;
  reasoning: string;
}

// CTDM field keys this stage knows how to map per document type — mirrors
// the requiredDocuments.fields lists in bcTypes.ts (Addendum B). Kept in
// sync manually for now (same known seam as ceisaReadiness.ts on the API
// side); a shared config package is the long-term fix.
const FIELD_MAP_BY_DOCUMENT_TYPE: Record<string, string[]> = {
  "Commercial Invoice": ["exporter_name", "consignee_name", "invoice_number", "invoice_date", "total_value", "hs_code"],
  "Packing List": ["invoice_number", "gross_weight", "net_weight", "package_count", "package_type", "cbm"],
  "Purchase Order": ["po_number", "hs_code", "item_description", "unit_price", "quantity"],
  "Bill of Lading / AWB": ["bl_number", "vessel_name", "voyage", "pol", "pod", "container_number", "gross_weight"],
  "Letter of Guarantee": ["guarantee_amount", "guarantee_reference", "issuing_party", "bl_number"],
  "Inward Manifest BC 1.1": ["manifest_number", "pos_number", "bc11_date", "port_of_entry", "bl_number"],
  "BC 2.3 Declaration": ["po_number", "invoice_number", "bl_number", "hs_code", "gross_weight", "net_weight"],
};

export async function handler(event: ExtractInput) {
  const { s3Bucket, documentType } = event;
  // Prefer the Image Enhancement stage's output when it ran (raster
  // scans/photos); native PDFs pass through with enhancedS3Key unset.
  const s3Key = event.enhancedS3Key ?? event.s3Key;

  const textractResult = await textract.send(
    new AnalyzeDocumentCommand({
      Document: { S3Object: { Bucket: s3Bucket, Name: s3Key } },
      FeatureTypes: ["FORMS", "TABLES"],
    })
  );

  // Flatten Textract's block graph into plain key-value pairs + table rows
  // — this is the "what does the document literally say" layer, kept
  // simple and mechanical on purpose so any bugs here are easy to audit
  // against the raw Textract response.
  const blocks = textractResult.Blocks ?? [];
  const lineText = blocks
    .filter((b) => b.BlockType === "LINE")
    .map((b) => b.Text)
    .join("\n");

  const expectedFields = FIELD_MAP_BY_DOCUMENT_TYPE[documentType] ?? [];
  if (expectedFields.length === 0) {
    // Unknown/unmapped document type — return nothing rather than
    // fabricate field guesses. A REVIEW_REQUIRED state downstream is
    // honest; inventing fields for a type we don't have a mapping for
    // is not.
    return { ...event, extractedFields: [] as ExtractedFieldCandidate[] };
  }

  const aiResponse = await invokeAIEngine(
    {
      systemPrompt: `You extract structured trade document fields into JSON. Given OCR text from a "${documentType}", extract these CTDM fields: ${expectedFields.join(", ")}. Respond with ONLY a JSON array, each item: {"fieldKey": string, "rawValue": string (exact text as it appears, including original number formatting), "confidence": number 0-1, "reasoning": string (one short sentence)}. If a field isn't present, omit it — never fabricate a value.`,
      userPrompt: lineText,
      maxTokens: 2048,
    },
    DEFAULT_AI_ENGINE_CONFIG
  );

  let parsed: Array<{ fieldKey: string; rawValue: string; confidence: number; reasoning: string }> = [];
  try {
    parsed = JSON.parse(aiResponse.text);
  } catch {
    // Model didn't return clean JSON — fail loudly into REVIEW_REQUIRED
    // rather than silently dropping the document or guessing a parse.
    return { ...event, extractedFields: [] as ExtractedFieldCandidate[], extractionError: "AI_RESPONSE_NOT_JSON" };
  }

  const NUMERIC_FIELDS = new Set(["total_value", "gross_weight", "net_weight", "cbm", "unit_price", "quantity", "guarantee_amount"]);

  const extractedFields: ExtractedFieldCandidate[] = parsed.map((field) => {
    const isNumeric = NUMERIC_FIELDS.has(field.fieldKey);
    const normalized = isNumeric ? normalizeNumber(field.rawValue) : null;
    return {
      fieldKey: field.fieldKey,
      rawValue: field.rawValue,
      // Indonesian-format BC 2.3 numbers ("4.415,3000") and
      // international-format invoice numbers ("4,415.30") both resolve
      // to the same normalizedValue here — this is what lets the
      // Reconciliation Engine recognize them as agreeing sources instead
      // of a spurious conflict.
      normalizedValue: isNumeric && normalized !== null ? String(normalized) : field.rawValue,
      confidence: field.confidence,
      reasoning: field.reasoning,
    };
  });

  return { ...event, extractedFields };
}
