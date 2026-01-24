"use client";

import { useMemo, useRef, useState } from "react";

type DieKey = "d2" | "d4" | "d6" | "d8" | "d10" | "d12" | "d20" | "d100";

// Ordered by "seniority": d2 (coin), d4, d6, d8, d10, d12, d20, d100
const dice: Array<{ key: DieKey; sides: number }> = [
  { key: "d2", sides: 2 },
  { key: "d4", sides: 4 },
  { key: "d6", sides: 6 },
  { key: "d8", sides: 8 },
  { key: "d10", sides: 10 },
  { key: "d12", sides: 12 },
  { key: "d20", sides: 20 },
  { key: "d100", sides: 100 }
];

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function formatResult(key: DieKey, n: number) {
  return String(n);
}

export function DiceTool() {
  const [selected, setSelected] = useState<DieKey>("d6");
  const [rolling, setRolling] = useState(false);
  const [result, setResult] = useState<string>("—");
  const rafRef = useRef<number | null>(null);

  const die = useMemo(() => dice.find((d) => d.key === selected)!, [selected]);
  const title = useMemo(() => (selected.toUpperCase()), [selected]);

  function stopAnim() {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function roll(next?: DieKey) {
    const key = next ?? selected;
    const nextDie = dice.find((d) => d.key === key)!;
    setSelected(key);

    setRolling(true);
    stopAnim();

    const durationMs = 150;
    const start = performance.now();

    const tick = (now: number) => {
      const t = now - start;
      const n = randInt(1, nextDie.sides);
      setResult(formatResult(key, n));

      if (t >= durationMs) {
        // final value
        const finalN = randInt(1, nextDie.sides);
        setResult(formatResult(key, finalN));
        setRolling(false);
        rafRef.current = null;
        return;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="toolWrap rollTool" role="region" aria-label="Roll tool">
      <div className="toolTitle">
        <span className="kw">tool</span>
        <span style={{ margin: "0 8px", color: "var(--muted)" }}>→</span>
        <span className="fn">Roll</span>
        <span style={{ marginLeft: 10, color: "var(--muted)" }}>/</span>
        <span style={{ marginLeft: 10, color: "var(--text)" }}>{title}</span>
      </div>

      <div className={`diceStage diceStageLeft ${rolling ? "diceStageRolling" : ""}`} aria-label="Roll result">
        <div className="diceBig">
          <div className="diceBigLabel">{selected.toUpperCase()}</div>
          <div className="diceBigValue">{result}</div>
        </div>
      </div>

      <div className="diceRow" role="list" aria-label="Dice list">
        {dice.map((d) => (
          <button
            key={d.key}
            type="button"
            className={`dieIconBtn ${d.key === selected ? "dieIconBtnActive" : ""}`}
            onClick={() => roll(d.key)}
            aria-pressed={d.key === selected}
            aria-label={d.key}
          >
            <img
              className="dieImg"
              src={`/dice/d${d.sides}.svg`}
              alt=""
              width={64}
              height={64}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

