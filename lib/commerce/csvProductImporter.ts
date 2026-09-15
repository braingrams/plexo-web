// Shared CSV parsing/validation for the products bulk-import flow (CsvImportDialog.tsx +
// app/api/v1/commerce/[templateId]/products/import/route.ts). Pure, dependency-free (no
// papaparse/csv-parse) so the exact same code runs client-side for the live preview table
// and server-side for the final authoritative validation before insert — no logic drift
// between the two. Field names mirror the CommerceProduct entity (lib/db/commerceEntities.ts)
// and the POST /products body (route.ts), just flattened to plain CSV-friendly strings
// (e.g. "price" in major currency units, not "priceMinor").

export type ProductCsvField =
  | "sku"
  | "name"
  | "description"
  | "kind"
  | "price"
  | "stockQuantity"
  | "durationMinutes"
  | "category"
  | "imageUrl"
  | "active";

export interface ProductCsvFieldDef {
  key: ProductCsvField;
  label: string;
  required: boolean;
}

// Order here is also the column order of the downloadable sample CSV.
export const PRODUCT_CSV_FIELDS: ProductCsvFieldDef[] = [
  { key: "sku", label: "SKU", required: true },
  { key: "name", label: "Name", required: true },
  { key: "description", label: "Description", required: false },
  {
    key: "kind",
    label: "Type (PHYSICAL, SERVICE, or DIGITAL)",
    required: true,
  },
  { key: "price", label: "Price", required: true },
  {
    key: "stockQuantity",
    label: "Stock quantity (PHYSICAL only)",
    required: false,
  },
  {
    key: "durationMinutes",
    label: "Duration in minutes (SERVICE only)",
    required: false,
  },
  { key: "category", label: "Category", required: false },
  { key: "imageUrl", label: "Image URL", required: false },
  { key: "active", label: "Active (true/false)", required: false },
];

const SAMPLE_ROWS: string[][] = [
  [
    "TEE-001",
    "Classic Cotton T-Shirt",
    "Soft, breathable 100% cotton tee.",
    "PHYSICAL",
    "8500",
    "40",
    "",
    "Apparel",
    "",
    "true",
  ],
  [
    "CONSULT-30",
    "30-Minute Strategy Call",
    "One-on-one consulting session over video call.",
    "SERVICE",
    "25000",
    "",
    "30",
    "Consulting",
    "",
    "true",
  ],
  [
    "EBOOK-GROWTH",
    "Growth Playbook (PDF)",
    "A 40-page guide to growing a small online store.",
    "DIGITAL",
    "4000",
    "",
    "",
    "Guides",
    "",
    "true",
  ],
];

/** RFC4180-ish CSV parser: handles quoted fields, escaped quotes (""), commas/newlines
 * inside quotes, and both \n and \r\n line endings. Returns raw string cells only — no
 * type coercion or trimming, since header/data rows need slightly different handling. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (inQuotes) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  // Flush the final field/row (files don't always end with a trailing newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows (a common artifact of a trailing newline).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function escapeCsvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Builds the downloadable "Download Sample CSV" template: standard headers plus a
 * handful of realistic rows covering all three product kinds. */
export function buildSampleCsv(): string {
  const headerRow = PRODUCT_CSV_FIELDS.map((f) => f.key).join(",");
  const dataRows = SAMPLE_ROWS.map((row) => row.map(escapeCsvCell).join(","));
  return [headerRow, ...dataRows].join("\n");
}

/** Cheap heuristic fallback for suggesting a column mapping without calling the AI —
 * used when no AI provider is configured, or as the mapping shown while the AI request is
 * in flight. Matches on exact key, then on label words appearing in the header text. */
export function autoDetectColumnMapping(
  headers: string[],
): Record<number, ProductCsvField | null> {
  const mapping: Record<number, ProductCsvField | null> = {};
  const used = new Set<ProductCsvField>();

  headers.forEach((rawHeader, index) => {
    const normalized = rawHeader
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    let match = PRODUCT_CSV_FIELDS.find(
      (f) => !used.has(f.key) && f.key.toLowerCase() === normalized,
    );
    if (!match) {
      match = PRODUCT_CSV_FIELDS.find((f) => {
        if (used.has(f.key)) return false;
        const labelWords = f.label
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .split(" ")
          .filter(Boolean);
        return labelWords.some(
          (word) => word.length > 2 && normalized.includes(word),
        );
      });
    }
    mapping[index] = match ? match.key : null;
    if (match) used.add(match.key);
  });

  return mapping;
}

export interface ParsedProductRow {
  /** 1-based position among data rows (excluding the header row), for display. */
  rowNumber: number;
  sku: string;
  name: string;
  description: string | null;
  kind: "PHYSICAL" | "SERVICE" | "DIGITAL";
  priceMinor: number;
  stockQuantity: number | null;
  durationMinutes: number | null;
  category: string | null;
  imageUrl: string | null;
  active: boolean;
  errors: string[];
}

function cellFor(
  row: string[],
  columnMapping: Record<number, ProductCsvField | null>,
  field: ProductCsvField,
): string {
  const columnIndex = Object.entries(columnMapping).find(
    ([, mapped]) => mapped === field,
  )?.[0];
  if (columnIndex === undefined) return "";
  return (row[Number(columnIndex)] ?? "").trim();
}

/** Parses+validates every data row against the mapped columns. `existingSkus` (already
 * lower-cased) is optional so the same function works purely client-side (preview, no DB
 * access) or server-side (final pass, checked against the template's existing catalog). */
export function buildProductRows(
  dataRows: string[][],
  columnMapping: Record<number, ProductCsvField | null>,
  existingSkus?: Set<string>,
): ParsedProductRow[] {
  const rows: ParsedProductRow[] = dataRows.map((raw, index) => {
    const errors: string[] = [];

    const sku = cellFor(raw, columnMapping, "sku");
    if (!sku) errors.push("SKU is required.");

    const name = cellFor(raw, columnMapping, "name");
    if (!name) errors.push("Name is required.");

    const kindRaw = cellFor(raw, columnMapping, "kind").toUpperCase();
    const kind: "PHYSICAL" | "SERVICE" | "DIGITAL" =
      kindRaw === "PHYSICAL" || kindRaw === "SERVICE" || kindRaw === "DIGITAL"
        ? kindRaw
        : "PHYSICAL";
    if (
      kindRaw !== "PHYSICAL" &&
      kindRaw !== "SERVICE" &&
      kindRaw !== "DIGITAL"
    ) {
      errors.push('Type must be "PHYSICAL", "SERVICE", or "DIGITAL".');
    }

    const priceRaw = cellFor(raw, columnMapping, "price").replace(
      /[^0-9.]/g,
      "",
    );
    const price = Number(priceRaw);
    const priceMinor =
      Number.isFinite(price) && price >= 0 ? Math.round(price * 100) : NaN;
    if (!Number.isFinite(priceMinor))
      errors.push("Price must be a valid non-negative number.");

    const stockRaw = cellFor(raw, columnMapping, "stockQuantity");
    let stockQuantity: number | null = null;
    if (stockRaw) {
      const parsed = Number(stockRaw.replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(parsed))
        errors.push("Stock quantity must be a number.");
      else stockQuantity = Math.max(0, Math.trunc(parsed));
    }

    const durationRaw = cellFor(raw, columnMapping, "durationMinutes");
    let durationMinutes: number | null = null;
    if (durationRaw) {
      const parsed = Number(durationRaw.replace(/[^0-9.-]/g, ""));
      if (!Number.isFinite(parsed)) errors.push("Duration must be a number.");
      else durationMinutes = Math.max(5, Math.trunc(parsed));
    }

    const category = cellFor(raw, columnMapping, "category") || null;
    const imageUrl = cellFor(raw, columnMapping, "imageUrl") || null;
    const activeRaw = cellFor(raw, columnMapping, "active").toLowerCase();
    const active =
      activeRaw === "" ? true : ["true", "1", "yes", "y"].includes(activeRaw);

    return {
      rowNumber: index + 1,
      sku,
      name,
      description: cellFor(raw, columnMapping, "description") || null,
      kind,
      priceMinor: Number.isFinite(priceMinor) ? priceMinor : 0,
      stockQuantity,
      durationMinutes,
      category,
      imageUrl,
      active,
      errors,
    };
  });

  // Duplicate-SKU detection: within the file itself, and (when provided) against the
  // template's existing catalog.
  const seenInFile = new Map<string, number>();
  for (const row of rows) {
    if (!row.sku) continue;
    const key = row.sku.toLowerCase();
    const firstSeenAt = seenInFile.get(key);
    if (firstSeenAt !== undefined) {
      row.errors.push(`Duplicate SKU — already used on row ${firstSeenAt}.`);
    } else {
      seenInFile.set(key, row.rowNumber);
      if (existingSkus?.has(key)) {
        row.errors.push("SKU already exists in this store's catalog.");
      }
    }
  }

  return rows;
}
