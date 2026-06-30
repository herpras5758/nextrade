// Business Rule Validation — IDP Engine module #6, distinct from
// Reconciliation Engine's confidence scoring. A field can have 0.95
// confidence (the OCR/AI is very sure it read "8452.21.00" correctly)
// and STILL be invalid (wrong HS code format, expired date, negative
// weight). Confidence answers "did we read this right?"; business rule
// validation answers "is this value actually valid, given what it
// claims to be?" Two different questions, both necessary.
//
// Config-driven (Rule #4) — rules are data, not branching logic, so a
// new BC type's field constraints mean adding config entries here, not
// new if/else.

export type ValidationRuleType = "regex" | "range" | "date_not_future" | "date_not_past_years" | "enum" | "required";

export interface ValidationRule {
  fieldKey: string;
  ruleType: ValidationRuleType;
  param?: string | number | string[]; // regex pattern, range bound, enum values, etc
  message: string;
}

export const BUSINESS_VALIDATION_RULES: ValidationRule[] = [
  {
    fieldKey: "hs_code",
    ruleType: "regex",
    param: "^\\d{4}\\.\\d{2}(\\.\\d{2})?$",
    message: "HS Code must be in format NNNN.NN or NNNN.NN.NN",
  },
  {
    fieldKey: "gross_weight",
    ruleType: "range",
    param: 0, // must be > 0
    message: "Gross weight must be a positive number",
  },
  {
    fieldKey: "net_weight",
    ruleType: "range",
    param: 0,
    message: "Net weight must be a positive number",
  },
  {
    fieldKey: "total_value",
    ruleType: "range",
    param: 0,
    message: "Total value must be a positive number",
  },
  {
    fieldKey: "invoice_date",
    ruleType: "date_not_future",
    message: "Invoice date cannot be in the future",
  },
  {
    fieldKey: "invoice_date",
    ruleType: "date_not_past_years",
    param: 2,
    message: "Invoice date is more than 2 years old — verify this is not a stale/reused invoice",
  },
  {
    fieldKey: "country_origin",
    ruleType: "regex",
    param: "^[A-Z]{2}(\\s*\\([A-Za-z\\s]+\\))?$",
    message: "Country of origin should be an ISO 2-letter code (optionally followed by full name)",
  },
];

export interface BusinessValidationResult {
  fieldKey: string;
  ruleType: ValidationRuleType;
  passed: boolean;
  message: string;
}

export function runBusinessValidation(fieldKey: string, value: string): BusinessValidationResult[] {
  const rules = BUSINESS_VALIDATION_RULES.filter((r) => r.fieldKey === fieldKey);
  return rules.map((rule) => ({
    fieldKey,
    ruleType: rule.ruleType,
    passed: evaluateRule(rule, value),
    message: rule.message,
  }));
}

function evaluateRule(rule: ValidationRule, value: string): boolean {
  if (value === null || value === undefined || value.trim() === "") {
    return rule.ruleType !== "required" ? true : false; // empty values pass non-required rules; "required" handled elsewhere (Rule #5 mandatory field check)
  }

  switch (rule.ruleType) {
    case "regex":
      return new RegExp(rule.param as string).test(value.trim());

    case "range": {
      const num = Number(value.replace(/[^\d.-]/g, ""));
      return Number.isFinite(num) && num > (rule.param as number);
    }

    case "date_not_future": {
      const date = parseFlexibleDate(value);
      return date !== null && date.getTime() <= Date.now();
    }

    case "date_not_past_years": {
      const date = parseFlexibleDate(value);
      if (date === null) return true; // can't parse -> don't double-flag, regex/format issue is a separate concern
      const years = rule.param as number;
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - years);
      return date.getTime() >= cutoff.getTime();
    }

    case "enum":
      return (rule.param as string[]).includes(value.trim());

    default:
      return true;
  }
}

/** Handles the common date shapes seen in trade documents: DD/MM/YYYY, YYMMDD, ISO. */
function parseFlexibleDate(raw: string): Date | null {
  const trimmed = raw.trim();

  // ISO-ish: 2026-06-12 or 2026/06/12
  const isoMatch = trimmed.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (isoMatch) return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));

  // DD/MM/YYYY (common on Indonesian customs forms)
  const dmyMatch = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
  if (dmyMatch) return new Date(Number(dmyMatch[3]), Number(dmyMatch[2]) - 1, Number(dmyMatch[1]));

  // 6-digit shorthand seen on the sample BC 2.3 ("DATE OF ISSUE 260505" = 2026-05-05)
  const shortMatch = trimmed.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (shortMatch) return new Date(2000 + Number(shortMatch[1]), Number(shortMatch[2]) - 1, Number(shortMatch[3]));

  const fallback = new Date(trimmed);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}
