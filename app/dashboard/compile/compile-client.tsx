"use client";

import React, { useState, useEffect } from "react";

export default function CompileClientPage() {
  const [activeTab, setActiveTab] = useState<"html-to-json" | "json-to-html">("html-to-json");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSplitPreview, setShowSplitPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [collapseState, setCollapseState] = useState<"none" | "left" | "right">("none");

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
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error ?? `Compile failed (${response.status})`);
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
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error ?? `Compile failed (${response.status})`);
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

  const handleCopy = () => {
    if (!outputText) return;
    navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderLeftHeaderControls = () => {
    if (!showSplitPreview) return null;
    return (
      <div className="flex items-center gap-1.5 ml-2">
        {collapseState === "right" ? (
          <button
            onClick={() => setCollapseState("none")}
            title="Restore Split View"
            className="p-1 text-slate-400 hover:text-white transition rounded hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 3v18" />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => setCollapseState("right")}
            title="Collapse Preview (Show Code Fullwidth)"
            className="p-1 text-slate-400 hover:text-white transition rounded hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 17V7l7 5-7 5z" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  const renderRightHeaderControls = () => {
    if (!showSplitPreview) return null;
    return (
      <div className="flex items-center gap-1.5 ml-2">
        {collapseState === "left" ? (
          <button
            onClick={() => setCollapseState("none")}
            title="Restore Split View"
            className="p-1 text-slate-400 hover:text-white transition rounded hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M12 3v18" />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => setCollapseState("left")}
            title="Collapse Code (Show Preview Fullwidth)"
            className="p-1 text-slate-400 hover:text-white transition rounded hover:bg-slate-800"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M15 7v10l-7-5 7-5z" />
            </svg>
          </button>
        )}
      </div>
    );
  };

  const renderEditorBoxContent = () => (
    <>
      <div className="bg-[#0e1526] px-4 py-3 border-b border-slate-800 flex justify-between items-center h-[46px] shrink-0">
        <div className="flex items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {activeTab === "html-to-json" ? "Pasted HTML / MJML Markup" : "Pasted Builder JSON template"}
          </span>
          {renderLeftHeaderControls()}
        </div>
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
          className="w-full h-full bg-transparent p-4 font-mono text-xs leading-relaxed outline-none border-none text-slate-300 resize-none absolute inset-0"
        />
      </div>
    </>
  );

  const renderOutputBoxContent = () => (
    <>
      <div className="bg-[#0e1526] px-4 py-3 border-b border-slate-800 flex justify-between items-center h-[46px] shrink-0">
        <div className="flex items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            {activeTab === "html-to-json" ? "Compiled JSON Output" : "Compiled HTML Output"}
          </span>
          {activeTab === "json-to-html" && renderLeftHeaderControls()}
        </div>
        {outputText && (
          <button
            onClick={handleCopy}
            className={`text-xs font-semibold transition ${copied ? "text-emerald-400 font-bold" : "text-indigo-400 hover:text-indigo-300"}`}
          >
            {copied ? "Copied!" : "Copy Output"}
          </button>
        )}
      </div>
      <div className="flex-1 relative bg-transparent">
        {error ? (
          <div className="p-4 text-xs font-semibold text-rose-400 bg-rose-950/10 absolute inset-0 overflow-auto">
            Error: {error}
          </div>
        ) : (
          <pre className="w-full h-full p-4 font-mono text-xs text-slate-300 select-text absolute inset-0 overflow-auto">
            {outputText || "// Click Compile to process output..."}
          </pre>
        )}
      </div>
    </>
  );

  const renderLivePreviewContent = () => (
    <>
      <div className="bg-[#0e1526] px-4 py-3 border-b border-slate-800 flex justify-between items-center h-[46px] shrink-0">
        <div className="flex items-center">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Live Preview</span>
          {renderRightHeaderControls()}
        </div>
        <button
          onClick={() => {
            setShowSplitPreview(false);
            setCollapseState("none");
          }}
          className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
        >
          Close Preview
        </button>
      </div>
      <div className="flex-1 bg-white relative">
        <iframe
          srcDoc={previewHtml}
          title="Compile Live Preview"
          className="w-full h-full border-none bg-white absolute inset-0"
        />
      </div>
    </>
  );

  return (
    <div style={{ fontFamily: "Inter, sans-serif", color: "#f1f5f9" }} className="flex flex-col gap-6 max-w-7xl mx-auto py-4">
      {/* Title */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Compile Studio</h1>
        <p className="text-sm text-slate-400 mt-1">
          Paste HTML to compile into JSON, or paste builder JSON to compile to clean responsive HTML.
        </p>
      </div>

      {/* Tabs / Header Control */}
      <div className="flex justify-between items-center border-b border-slate-800">
        <div className="flex gap-6">
          <button
            onClick={() => {
              setActiveTab("html-to-json");
              setInputText("");
              setOutputText("");
              setError(null);
              setShowSplitPreview(false);
              setCollapseState("none");
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
              setShowSplitPreview(false);
              setCollapseState("none");
            }}
            className={`pb-3 text-sm font-semibold border-b-2 transition ${activeTab === "json-to-html" ? "border-indigo-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}
          >
            JSON to HTML Compiler
          </button>
        </div>

        {previewHtml.trim() && (
          <button
            onClick={() => {
              const nextState = !showSplitPreview;
              setShowSplitPreview(nextState);
              setCollapseState("none");
            }}
            className={`mb-2 px-4 py-1.5 rounded text-xs font-bold transition flex items-center gap-1.5 ${
              showSplitPreview
                ? "bg-indigo-600/25 text-indigo-400 border border-indigo-500/30"
                : "bg-indigo-600 text-white hover:bg-indigo-500"
            }`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            {showSplitPreview ? "Show Code" : "Split Preview"}
          </button>
        )}
      </div>

      {/* Workspace Panel */}
      <div className="flex flex-col lg:flex-row gap-6 h-[calc(100vh-220px)] min-h-[500px] items-stretch">
        {/* Left Hand Column */}
        {(!showSplitPreview || collapseState !== "left") && (
          <div
            className={`flex flex-col border border-slate-800 rounded-xl bg-slate-950/40 overflow-hidden backdrop-blur-md transition-all duration-300 ${
              showSplitPreview && collapseState === "right" ? "w-full" : showSplitPreview ? "lg:w-1/2 w-full" : "w-full"
            }`}
          >
            {showSplitPreview && activeTab === "json-to-html" ? renderOutputBoxContent() : renderEditorBoxContent()}
          </div>
        )}

        {/* Right Hand Column */}
        {(!showSplitPreview || collapseState !== "right") && (
          <div
            className={`flex flex-col border border-slate-800 rounded-xl bg-slate-950/40 overflow-hidden backdrop-blur-md transition-all duration-300 ${
              showSplitPreview && collapseState === "left" ? "w-full" : showSplitPreview ? "lg:w-1/2 w-full" : "w-full"
            }`}
          >
            {showSplitPreview ? renderLivePreviewContent() : renderOutputBoxContent()}
          </div>
        )}
      </div>
    </div>
  );
}


