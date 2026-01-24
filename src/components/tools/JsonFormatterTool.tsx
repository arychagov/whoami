"use client";

import { useState } from "react";

export function JsonFormatterTool() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function doFormat() {
    try {
      setError(null);
      const parsed = JSON.parse(value);
      setValue(JSON.stringify(parsed, null, 2));
    } catch {
      setError("Format failed: please provide valid JSON.");
    }
  }

  return (
    <div className="toolWrap" role="region" aria-label="JSON Formatter tool">
      <div className="toolTitle">
        <span className="kw">tool</span>
        <span style={{ margin: "0 8px", color: "var(--muted)" }}>→</span>
        <span className="fn">JSON Formatter</span>
      </div>

      <textarea
        className="toolTextarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste JSON…"
        spellCheck={false}
      />

      {error ? <div className="toolError">{error}</div> : null}

      <div className="toolActions">
        <button className="toolBtn toolBtnPrimary" type="button" onClick={doFormat}>
          Format
        </button>
      </div>
    </div>
  );
}

