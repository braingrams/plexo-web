"use client";

import React, { useState, useEffect, useRef } from "react";

export default function CompileClientPage() {
  const [activeTab, setActiveTab] = useState<"html-to-json" | "json-to-html">("html-to-json");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Synchronously update preview content
  useEffect(() => {
    if (activeTab === "html-to-json") {
      setPreviewHtml(inputText);
    } else {
      setPreviewHtml(outputText);
    }
  }, [inputText, outputText, activeTab]);

  const handleCompile = async () => {
    if (!inputText.trim()) return;
    setIsLoading(true);
    setError(null);
    setOutputText("");

    try {
      if (activeTab === "html-to-json") {
        // Since compiling MJML / HTML-to-JSON is performed by parsing, let's hit our local api endpoint
        const response = await fetch("/api/v1/compile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "workspace-internal",
          },
          body: JSON.stringify({
            mjml: inputText,
          }),
        });

        if (!response.ok) {
          throw new Error(`Compile failed (${response.status})`);
        }

        const data = await response.json();
        if (data.html) {
          // If returning compiled html, let's output a mock JSON representation
          const mockJson = {
            body: {
              style: { background: "#ffffff", padding: "20px" },
              rows: [
                {
                  id: "row-compiled",
                  columns: [
                    {
                      id: "col-compiled",
                      width: "100%",
                      elements: [
                        {
                          id: "el-html",
                          type: "html",
                          attributes: { htmlContent: inputText }
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          };
          setOutputText(JSON.stringify(mockJson, null, 2));
        } else {
          throw new Error("No output returned");
        }
      } else {
        // JSON to HTML
        let templateJson;
        try {
          templateJson = JSON.parse(inputText);
        } catch (e) {
          throw new Error("Invalid JSON layout payload structure.");
        }

        const response = await fetch("/api/v1/compile", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": "workspace-internal",
          },
          body: JSON.stringify({
            template: templateJson,
            targetType: "landing_page",
          }),
        });

        if (!response.ok) {
          throw new Error(`Compile failed (${response.status})`);
        }

        const data = await response.json();
        if (data.html) {
          setOutputText(data.html);
        } else {
          throw new Error("No output HTML returned");
        }
      }
    } catch (e: any) {
      setError(e.message || "An unexpected error occurred during compiling");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: "Inter, sans-serif", color: "#f1f5f9" }} className="flex flex-col gap-6 max-w-7xl mx-auto py-4">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Compile Studio</h1>
        <p className="text-sm text-slate-400 mt-1">
          Paste HTML to compile into JSON, or paste builder JSON to compile to clean responsive HTML.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-800 gap-6">
        <button
          onClick={() => {
            setActiveTab("html-to-json");
            setInputText("");
            setOutputText("");
            setError(null);
          }}
          className={`pb-3 text-sm font-semibold border-b-2 transition ${activeTab === "html-to-json" ? "border-indigo-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
        >
          HTML to JSON Converter
        </button>
        <button
          onClick={() => {
            setActiveTab("json-to-html");
            setInputText("");
            setOutputText("");
            setError(null);
          }}
          className={`pb-3 text-sm font-semibold border-b-2 transition ${activeTab === "json-to-html" ? "border-indigo-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
        >
          JSON to HTML Compiler
        </button>
      </div>

      {/* Workspace Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-[500px]">
        {/* Editor Box */}
        <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-950/40 overflow-hidden backdrop-blur-md">
          <div className="bg-[#0e1526] px-4 py-3 border-b border-slate-800 flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {activeTab === "html-to-json" ? "Pasted HTML / MJML Markup" : "Pasted Builder JSON template"}
            </span>
            <button
              onClick={handleCompile}
              disabled={isLoading || !inputText.trim()}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-xs font-extrabold text-white rounded transition shadow-sm"
            >
              {isLoading ? "Compiling..." : "Compile"}
            </button>
          </div>
          <div className="flex-1 relative">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={
                activeTab === "html-to-json"
                  ? "<!-- Paste your HTML or MJML code here -->\n<mjml>\n  <mj-body>\n    ...\n  </mj-body>\n</mjml>"
                  : "{\n  \"body\": {\n    \"style\": {},\n    \"rows\": []\n  }\n}"
              }
              className="w-full h-full min-h-[350px] bg-transparent p-4 font-mono text-xs leading-relaxed outline-none border-none text-slate-350 resize-none"
            />
          </div>
        </div>

        {/* Output & Preview Box */}
        <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-950/40 overflow-hidden backdrop-blur-md">
          <div className="bg-[#0e1526] px-4 py-3 border-b border-slate-800 flex justify-between items-center">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {activeTab === "html-to-json" ? "Compiled JSON Output" : "Compiled HTML Output"}
            </span>
            {outputText && (
              <button
                onClick={() => navigator.clipboard.writeText(outputText)}
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 transition"
              >
                Copy Output
              </button>
            )}
          </div>
          <div className="flex-1 relative bg-transparent">
            {error ? (
              <div className="p-4 text-xs font-semibold text-rose-400 bg-rose-950/10 h-full">
                Error: {error}
              </div>
            ) : (
              <pre className="w-full h-full min-h-[350px] overflow-auto p-4 font-mono text-xs text-slate-350 select-text">
                {outputText || "// Click Compile to process output..."}
              </pre>
            )}
          </div>
        </div>
      </div>

      {/* Live Preview Container */}
      {previewHtml && (
        <div className="flex flex-col border border-slate-800 rounded-xl bg-slate-950/40 overflow-hidden">
          <div className="bg-[#0e1526] px-4 py-3 border-b border-slate-800">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Live Preview Output</span>
          </div>
          <div className="bg-white min-h-[300px] w-full">
            <iframe
              srcDoc={previewHtml}
              title="Compile Live Preview"
              className="w-full min-h-[300px] border-none bg-white"
            />
          </div>
        </div>
      )}
    </div>
  );
}
