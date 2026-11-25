"use client";

import { GateOrError } from "../../../_components/UpgradePrompt";
import { rememberPlanGate } from "@/lib/plan/planGate";
import { SolIcon, SolOutOfCredits } from "../../../_components/sol/SolTopUp";
import { useMemo, useRef, useState } from "react";
import {
  PRODUCT_CSV_FIELDS,
  buildProductRows,
  type ParsedProductRow,
  type ProductCsvField,
} from "@/lib/commerce/csvProductImporter";

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 4%, transparent)",
  border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
  borderRadius: 9,
  color: "var(--cmx-text, #f0f2ff)",
  padding: "0.55rem 0.7rem",
  fontSize: "0.85rem",
  outline: "none",
  fontFamily: "inherit",
};

type Step = "upload" | "mapping" | "preview" | "done";

export function AiImportDialog({
  templateId,
  onClose,
  onImported,
}: {
  templateId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [outOfCredits, setOutOfCredits] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [columnMapping, setColumnMapping] = useState<
    Record<number, ProductCsvField | null>
  >({});
  const [suggesting, setSuggesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    importedCount: number;
    skippedCount: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewRows: ParsedProductRow[] = useMemo(
    () =>
      dataRows.length > 0 ? buildProductRows(dataRows, columnMapping) : [],
    [dataRows, columnMapping],
  );
  const errorCount = previewRows.filter((r) => r.errors.length > 0).length;

  async function handleFile(file: File) {
    setError(null);
    setOutOfCredits(null);
    setFileName(file.name);
    setSuggesting(true);
    try {
      const body = new FormData();
      body.append("intent", "suggest_mapping");
      body.append("file", file);
      const res = await fetch(
        `/api/v1/commerce/${templateId}/products/import-ai`,
        { method: "POST", body },
      );
      const data = await res.json();
      // Out of AI credits → SOL's top-up card, then the same file is read again.
      if (res.status === 402) {
        setOutOfCredits(file);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "SOL couldn't read that file. Please try again.");
      setHeaders(data.headers ?? []);
      setDataRows(data.dataRows ?? []);
      setColumnMapping(data.columnMapping ?? {});
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "SOL couldn't read that file. Please try again.");
    } finally {
      setSuggesting(false);
    }
  }

  function updateMapping(columnIndex: number, field: ProductCsvField | null) {
    setColumnMapping((prev) => ({ ...prev, [columnIndex]: field }));
  }

  async function handleConfirmImport() {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/commerce/${templateId}/products/import-ai`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "commit",
            rows: dataRows,
            columnMapping,
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) { rememberPlanGate(data); throw new Error(data.error ?? "Import failed."); }
      setResult({
        importedCount: data.importedCount,
        skippedCount: data.skippedCount,
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "grid",
        placeItems: "center",
        background: "rgba(0,0,0,0.75)",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(100%,780px)",
          maxHeight: "85vh",
          overflowY: "auto",
          background: "var(--cmx-surface, #0d0f1a)",
          border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
          borderRadius: 18,
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "1rem",
          }}
        >
          <h2
            style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--cmx-text, #f0f2ff)" }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <SolIcon size={18} /> Import products with SOL
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--cmx-muted, rgba(240,242,255,0.5))",
              cursor: "pointer",
              fontSize: "1.1rem",
            }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {outOfCredits && (
          <div style={{ marginBottom: "0.75rem" }}>
            <SolOutOfCredits onDismiss={() => setOutOfCredits(null)} onToppedUp={() => void handleFile(outOfCredits)} />
          </div>
        )}
        {error && (
          <div style={{ marginBottom: "1rem" }}>
            <GateOrError error={error}>
              <div
                style={{
                  padding: "0.6rem 0.8rem",
                  borderRadius: 8,
                  background: "color-mix(in srgb, var(--cmx-danger, rgb(239,68,68)) 10%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--cmx-danger, rgb(239,68,68)) 30%, transparent)",
                  color: "var(--cmx-danger, #fca5a5)",
                  fontSize: "0.8rem",
                }}
              >
                {error}
              </div>
            </GateOrError>
          </div>
        )}

        {step === "upload" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <p style={{ fontSize: "0.82rem", color: "var(--cmx-muted, rgba(240,242,255,0.55))" }}>
              Upload a CSV or PDF product catalog. SOL reads it and lines the
              products up with your product list — no column setup needed. Uses credits.
            </p>
            <label
              style={{
                display: "grid",
                placeItems: "center",
                padding: "2rem",
                borderRadius: 12,
                border: "1.5px dashed color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 15%, transparent)",
                background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 2%, transparent)",
                cursor: suggesting ? "wait" : "pointer",
                color: "var(--cmx-muted, rgba(240,242,255,0.55))",
                fontSize: "0.85rem",
              }}
            >
              {suggesting
                ? "SOL is reading your file…"
                : fileName
                  ? `Selected: ${fileName}`
                  : "Click to choose a .csv or .pdf file"}
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.pdf,application/pdf"
                disabled={suggesting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                style={{ display: "none" }}
              />
            </label>
          </div>
        )}

        {step === "mapping" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <p style={{ fontSize: "0.82rem", color: "var(--cmx-muted, rgba(240,242,255,0.55))" }}>
              Check how SOL matched your file to product fields, then change any that
              look wrong.
            </p>
            <div style={{ display: "grid", gap: "0.6rem" }}>
              {headers.map((header, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "0.6rem",
                    alignItems: "center",
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.82rem",
                      color: "var(--cmx-text, #f0f2ff)",
                      fontWeight: 600,
                    }}
                  >
                    {header || `Column ${index + 1}`}
                  </span>
                  <select
                    value={columnMapping[index] ?? ""}
                    onChange={(e) =>
                      updateMapping(
                        index,
                        (e.target.value || null) as ProductCsvField | null,
                      )
                    }
                    style={{ ...inputStyle, cursor: "pointer" }}
                  >
                    <option value="">— Don't import —</option>
                    {PRODUCT_CSV_FIELDS.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? " *" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setStep("upload")}
                style={{
                  padding: "0.55rem 1rem",
                  borderRadius: 8,
                  border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
                  background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 5%, transparent)",
                  color: "var(--cmx-text, #f0f2ff)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "0.82rem",
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep("preview")}
                style={{
                  padding: "0.55rem 1rem",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background:
                    "linear-gradient(135deg,var(--brand),var(--cmx-brand-deep, var(--brand-deep)))",
                  color: "var(--cmx-on-brand, #fff)",
                  fontFamily: "inherit",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                }}
              >
                Continue to preview
              </button>
            </div>
          </div>
        )}

        {step === "preview" && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <p style={{ fontSize: "0.82rem", color: "var(--cmx-muted, rgba(240,242,255,0.55))" }}>
              {previewRows.length} row{previewRows.length === 1 ? "" : "s"}{" "}
              found — {previewRows.length - errorCount} ready to import
              {errorCount > 0
                ? `, ${errorCount} with errors (won't be imported)`
                : ""}
              .
            </p>
            <div
              style={{
                overflowX: "auto",
                border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 8%, transparent)",
                borderRadius: 10,
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.78rem",
                }}
              >
                <thead>
                  <tr style={{ background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 4%, transparent)" }}>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.5rem 0.7rem",
                        color: "var(--cmx-muted, rgba(240,242,255,0.5))",
                      }}
                    >
                      Row
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.5rem 0.7rem",
                        color: "var(--cmx-muted, rgba(240,242,255,0.5))",
                      }}
                    >
                      SKU
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.5rem 0.7rem",
                        color: "var(--cmx-muted, rgba(240,242,255,0.5))",
                      }}
                    >
                      Name
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.5rem 0.7rem",
                        color: "var(--cmx-muted, rgba(240,242,255,0.5))",
                      }}
                    >
                      Type
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.5rem 0.7rem",
                        color: "var(--cmx-muted, rgba(240,242,255,0.5))",
                      }}
                    >
                      Price
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "0.5rem 0.7rem",
                        color: "var(--cmx-muted, rgba(240,242,255,0.5))",
                      }}
                    >
                      Issues
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr
                      key={row.rowNumber}
                      style={{
                        borderTop: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 6%, transparent)",
                        background:
                          row.errors.length > 0
                            ? "color-mix(in srgb, var(--cmx-danger, rgb(239,68,68)) 8%, transparent)"
                            : "transparent",
                      }}
                    >
                      <td
                        style={{
                          padding: "0.5rem 0.7rem",
                          color: "var(--cmx-muted, rgba(240,242,255,0.5))",
                        }}
                      >
                        {row.rowNumber}
                      </td>
                      <td
                        style={{ padding: "0.5rem 0.7rem", color: "var(--cmx-text, #f0f2ff)" }}
                      >
                        {row.sku || "—"}
                      </td>
                      <td
                        style={{ padding: "0.5rem 0.7rem", color: "var(--cmx-text, #f0f2ff)" }}
                      >
                        {row.name || "—"}
                      </td>
                      <td
                        style={{ padding: "0.5rem 0.7rem", color: "var(--cmx-text, #f0f2ff)" }}
                      >
                        {row.kind}
                      </td>
                      <td
                        style={{ padding: "0.5rem 0.7rem", color: "var(--cmx-text, #f0f2ff)" }}
                      >
                        {(row.priceMinor / 100).toFixed(2)}
                      </td>
                      <td
                        style={{ padding: "0.5rem 0.7rem", color: "var(--cmx-danger, #fca5a5)" }}
                      >
                        {row.errors.length > 0 ? row.errors.join(" ") : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              style={{
                display: "flex",
                gap: "0.6rem",
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setStep("mapping")}
                style={{
                  padding: "0.55rem 1rem",
                  borderRadius: 8,
                  border: "1px solid color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 10%, transparent)",
                  background: "color-mix(in srgb, var(--cmx-ink, rgb(255,255,255)) 5%, transparent)",
                  color: "var(--cmx-text, #f0f2ff)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: "0.82rem",
                }}
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmImport()}
                disabled={importing || previewRows.length - errorCount === 0}
                style={{
                  padding: "0.55rem 1rem",
                  borderRadius: 8,
                  border: "none",
                  cursor:
                    importing || previewRows.length - errorCount === 0
                      ? "not-allowed"
                      : "pointer",
                  opacity:
                    importing || previewRows.length - errorCount === 0
                      ? 0.6
                      : 1,
                  background:
                    "linear-gradient(135deg,var(--brand),var(--cmx-brand-deep, var(--brand-deep)))",
                  color: "var(--cmx-on-brand, #fff)",
                  fontFamily: "inherit",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                }}
              >
                {importing
                  ? "Importing…"
                  : `Import ${previewRows.length - errorCount} product${previewRows.length - errorCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div style={{ display: "grid", gap: "1rem" }}>
            <p style={{ fontSize: "0.9rem", color: "var(--cmx-text, #f0f2ff)" }}>
              Imported {result.importedCount} product
              {result.importedCount === 1 ? "" : "s"}
              {result.skippedCount > 0
                ? `, skipped ${result.skippedCount} with errors.`
                : "."}
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={onImported}
                style={{
                  padding: "0.55rem 1rem",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  background:
                    "linear-gradient(135deg,var(--brand),var(--cmx-brand-deep, var(--brand-deep)))",
                  color: "var(--cmx-on-brand, #fff)",
                  fontFamily: "inherit",
                  fontSize: "0.82rem",
                  fontWeight: 700,
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
