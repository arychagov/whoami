"use client";

import { useState } from "react";

export function UrlCodecTool() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function doEncode() {
    setError(null);
    setValue(encodeURIComponent(value));
  }

  function doDecode() {
    try {
      setError(null);
      setValue(decodeURIComponent(value));
    } catch {
      setError("Failed to decode: check the correctness of %XX sequences.");
    }
  }

  return (
    <div className="toolWrap" role="region" aria-label="URL Encode/Decode tool">
      <div className="toolTitle">
        <span className="kw">tool</span>
        <span style={{ margin: "0 8px", color: "var(--muted)" }}>→</span>
        <span className="fn">URL Encode/Decode</span>
      </div>

      <textarea
        className="toolTextarea"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type text…"
        spellCheck={false}
      />

      {error ? <div className="toolError">{error}</div> : null}

      <div className="toolActions">
        <button className="toolBtn" type="button" onClick={doDecode}>
          Decode
        </button>
        <button className="toolBtn toolBtnPrimary" type="button" onClick={doEncode}>
          Encode
        </button>
      </div>
    </div>
  );
}

