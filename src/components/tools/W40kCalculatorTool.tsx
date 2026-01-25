"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Value = SimpleValue | RandomValue | CombinedValue;

type SimpleValue = { kind: "simple"; value: number };
type RandomValue = { kind: "random"; from: number; to: number };
type CombinedValue = { kind: "combined"; values: Value[] };

const none: Value = { kind: "simple", value: 0 };
const d6: Value = { kind: "random", from: 1, to: 6 };
const DEFAULT_ITERATIONS = 10_000;
const MAX_ATTACKS = 1000;
const TOO_MANY_ATTACKS_MSG = "Too many attacks";
const MAX_ADDITIONAL_HITS = 100;
const TOO_MANY_ADDITIONAL_HITS_MSG = "Too many additional hits";

function evalValue(v: Value): number {
  if (v.kind === "simple") return v.value;
  if (v.kind === "random") return randInt(v.from, v.to);
  return v.values.reduce((acc, x) => acc + evalValue(x), 0);
}

function maxValue(v: Value): number {
  if (v.kind === "simple") return v.value;
  if (v.kind === "random") return v.to;
  return v.values.reduce((acc, x) => acc + maxValue(x), 0);
}

function clampDigits(input: string, max: number): string {
  const trimmed = input.trim();
  if (!isDigitsOnly(trimmed)) return input;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return input;
  return String(Math.min(max, n));
}

function addValue(a: Value, b: Value): Value {
  return { kind: "combined", values: [a, b] };
}

function isDigitsOnly(s: string) {
  return /^[0-9]+$/.test(s);
}

function parseValue(input: string): Value {
  const trimmed = input.trim().toLowerCase();
  if (isDigitsOnly(trimmed)) return { kind: "simple", value: Number(trimmed) };

  // Could be something like (2d6 + 1)
  if (trimmed.includes("+")) {
    const split = trimmed.split("+");
    return {
      kind: "combined",
      values: split.map((x) => parseValue(x))
    };
  }

  if (trimmed.includes("d")) {
    const split = trimmed.split("d");
    if (split.length !== 2) throw new Error(`Cannot parse value '${input}'`);
    const max = Number(split[1]);
    if (!Number.isFinite(max)) throw new Error(`Cannot parse value '${input}'`);

    if (split[0].length === 0) return { kind: "random", from: 1, to: max };
    const dicesCount = Number(split[0]);
    if (!Number.isFinite(dicesCount)) throw new Error(`Cannot parse value '${input}'`);

    const dices: RandomValue[] = [];
    for (let i = 0; i < dicesCount; i++) dices.push({ kind: "random", from: 1, to: max });
    return { kind: "combined", values: dices };
  }

  throw new Error(`Cannot parse value '${input}'`);
}

function decrease(input: string, belowOne = false): string {
  const trimmed = input.trim().toLowerCase();
  if (isDigitsOnly(trimmed)) {
    const intValue = Number(trimmed);
    if (intValue < 2) return belowOne ? "0" : "1";
    return String(intValue - 1);
  }

  if (trimmed.includes("+")) {
    const addition = trimmed.split("+")[1]?.trim() ?? "";
    if (addition === "1") return trimmed.split("+")[0]!.trim();
    return `${trimmed.split("+")[0]!.trim()} + ${decrease(addition)}`;
  }

  return input;
}

function increase(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (isDigitsOnly(trimmed)) return String(Number(trimmed) + 1);

  if (trimmed.includes("+")) {
    const addition = trimmed.split("+")[1]?.trim() ?? "";
    return `${trimmed.split("+")[0]!.trim()} + ${increase(addition)}`;
  }

  return `${input.trim()} + 1`;
}

function formatFloat(x: number, digits = 2) {
  return x.toFixed(digits);
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

type RerollRule =
  | { kind: "no" }
  | { kind: "ones" }
  | { kind: "full" }
  | { kind: "single" };

function canReroll(rule: RerollRule, result: number, singleRerolledRef: { used: boolean }) {
  switch (rule.kind) {
    case "no":
      return false;
    case "full":
      return true;
    case "ones":
      return result === 1;
    case "single":
      if (singleRerolledRef.used) return false;
      singleRerolledRef.used = true;
      return true;
  }
}

type DamageOnRollRule = { kind: "no" } | { kind: "onHit"; onResult: number; mortalWounds: Value };
function getMortalWounds(rule: DamageOnRollRule, result: number): Value {
  if (rule.kind === "no") return none;
  return result >= rule.onResult ? rule.mortalWounds : none;
}

type AutoWoundRule = { kind: "no" } | { kind: "onResult"; onResult: number };
function isAutoWound(rule: AutoWoundRule, result: number): boolean {
  if (rule.kind === "no") return false;
  return result >= rule.onResult;
}

type AutoHitRule = { kind: "no" } | { kind: "always" };

type AdditionalHitRule = { kind: "no" } | { kind: "onResult"; onResult: number; additionalHits: Value };
function getAdditionalHits(rule: AdditionalHitRule, result: number): Value {
  if (rule.kind === "no") return none;
  return result >= rule.onResult ? rule.additionalHits : none;
}

type PenetrationRule =
  | { kind: "no" }
  | { kind: "additionalOnResult"; onResult: number; additionalPenetration: Value }
  | { kind: "onResult"; onResult: number; newPenetration: Value };

function getPenetrationIncrease(rule: PenetrationRule, result: number, penetration: Value): Value {
  if (rule.kind === "no") return penetration;
  if (result < rule.onResult) return penetration;
  return rule.kind === "additionalOnResult" ? addValue(penetration, rule.additionalPenetration) : rule.newPenetration;
}

type DamageCharacteristicRule =
  | { kind: "no" }
  | { kind: "additionalOnResult"; onResult: number; additionalDamage: Value }
  | { kind: "onResult"; onResult: number; damage: Value };

function getResultDamage(rule: DamageCharacteristicRule, result: number, damageCharacteristic: Value): Value {
  if (rule.kind === "no") return damageCharacteristic;
  if (result < rule.onResult) return damageCharacteristic;
  return rule.kind === "additionalOnResult" ? addValue(damageCharacteristic, rule.additionalDamage) : rule.damage;
}

type StrengthHitRule =
  | { kind: "no" }
  | { kind: "additionalOnResult"; onResult: number; additionalStrength: Value }
  | { kind: "onResult"; onResult: number; newStrength: Value };

function getResultStrength(rule: StrengthHitRule, result: number, strength: Value): Value {
  if (rule.kind === "no") return strength;
  if (result < rule.onResult) return strength;
  return rule.kind === "additionalOnResult" ? addValue(strength, rule.additionalStrength) : rule.newStrength;
}

type Hit = {
  strength: Value;
  penetration: Value;
  damage: Value;
};

type AttackResult = {
  mortalWounds: Value[];
  hits: Hit[];
  autoWound: Hit[];
};

type WoundResult = {
  mortalWounds: Value[];
  hits: Hit[];
};

type Defender = {
  hitTranshuman: boolean;
  woundTranshuman: boolean;
  toughness: Value;
  save: Value;
  invulnerableSave: Value;
  feelNoPain: number;
  damageDecrease: Value;
};

type Attacker = {
  attacks: Value;
  skill: number;
  strength: Value;
  penetration: Value;
  damage: Value;

  additionalHitRule: AdditionalHitRule;
  autoHitRule: AutoHitRule;
  rerollRule: RerollRule;
  plusOneToHit: boolean;
  damageCharacteristicHitRule: DamageCharacteristicRule;
  damageHitRule: DamageOnRollRule;
  autoWoundRule: AutoWoundRule;
  penetrationHitRule: PenetrationRule;
  strengthHitRule: StrengthHitRule;

  woundRerollRule: RerollRule;
  plusOneToWound: boolean;
  damageCharacteristicWoundRule: DamageCharacteristicRule;
  damageWoundRule: DamageOnRollRule;
  penetrationWoundRule: PenetrationRule;
};

function doSave(defender: Defender, woundResult: WoundResult): number {
  const wounds: Value[] = [];
  wounds.push(...woundResult.mortalWounds);
  const saveCharacteristic = evalValue(defender.save);

  for (const hit of woundResult.hits) {
    const rollToSave = Math.min(saveCharacteristic + evalValue(hit.penetration), evalValue(defender.invulnerableSave));
    const saveRoll = evalValue(d6);
    if (saveRoll === 1 || saveRoll < rollToSave) {
      wounds.push(hit.damage);
    }
  }

  const totalWounds = wounds.reduce((acc, v) => acc + Math.max(evalValue(v) - evalValue(defender.damageDecrease), 1), 0);

  if (defender.feelNoPain > 6) return totalWounds;

  let resultWounds = 0;
  for (let i = 0; i < totalWounds; i++) {
    const fnpRoll = evalValue(d6);
    if (fnpRoll < defender.feelNoPain) resultWounds += 1;
  }
  return resultWounds;
}

function passValue(toughness: number, strength: number) {
  if (toughness * 2 <= strength) return 2;
  if (toughness < strength) return 3;
  if (toughness === strength) return 4;
  if (toughness >= strength * 2) return 6;
  return 5;
}

function doHit(attacker: Attacker, defender: Defender): AttackResult {
  let numberOfAttacks = evalValue(attacker.attacks);
  const hits: Hit[] = [];
  const autoWounds: Hit[] = [];
  const wounds: Value[] = [];
  const failedRolls: number[] = [];

  const rerollState = { used: false };
  let firstRoll = true;

  do {
    for (let i = 0; i < numberOfAttacks; i++) {
      if (attacker.autoHitRule.kind === "always") {
        hits.push({ strength: attacker.strength, penetration: attacker.penetration, damage: attacker.damage });
        continue;
      }

      const result = evalValue(d6);
      if (defender.hitTranshuman && result <= 4) {
        failedRolls.push(result);
        continue;
      }

      const additionalToHit = attacker.plusOneToHit ? 1 : 0;
      if (result === 1 || (result !== 6 && result + additionalToHit < attacker.skill)) {
        failedRolls.push(result);
        continue;
      }

      const damageCharacteristic = getResultDamage(attacker.damageCharacteristicHitRule, result, attacker.damage);
      const strengthCharacteristic = getResultStrength(attacker.strengthHitRule, result, attacker.strength);
      const penetrationCharacteristic = getPenetrationIncrease(attacker.penetrationHitRule, result, attacker.penetration);
      const additionalHits = getAdditionalHits(attacker.additionalHitRule, result);
      wounds.push(getMortalWounds(attacker.damageHitRule, result));

      if (isAutoWound(attacker.autoWoundRule, result)) {
        autoWounds.push({
          strength: strengthCharacteristic,
          penetration: penetrationCharacteristic,
          damage: damageCharacteristic
        });
        continue;
      }

      const resultHits = evalValue(additionalHits) + 1;
      for (let j = 0; j < resultHits; j++) {
        hits.push({
          strength: strengthCharacteristic,
          penetration: penetrationCharacteristic,
          damage: damageCharacteristic
        });
      }
    }

    numberOfAttacks = 0;
    if (firstRoll) {
      for (const failedRoll of failedRolls) {
        if (canReroll(attacker.rerollRule, failedRoll, rerollState)) numberOfAttacks += 1;
      }
      firstRoll = false;
    }
  } while (numberOfAttacks > 0);

  return {
    mortalWounds: wounds.filter((x) => !(x.kind === "simple" && x.value === 0)),
    hits,
    autoWound: autoWounds
  };
}

function doWound(attacker: Attacker, attackResult: AttackResult, defender: Defender): WoundResult {
  const mortalWounds: Value[] = [];
  mortalWounds.push(...attackResult.mortalWounds);

  const hits: Hit[] = [];
  hits.push(...attackResult.autoWound);

  const toughness = evalValue(defender.toughness);
  const rerollState = { used: false };

  for (const hit of attackResult.hits) {
    const result = evalValue(d6);
    const strength = evalValue(hit.strength);
    const pass = passValue(toughness, strength);
    const additionalToWound = attacker.plusOneToWound ? 1 : 0;

    // Transhuman: cannot wound on 1-3 (and 4 in this implementation to match the Android UI label).
    if (defender.woundTranshuman && result <= 4) {
      // still allow reroll if configured
      if (canReroll(attacker.woundRerollRule, result, rerollState)) {
        const newResult = evalValue(d6);
        if (!defender.woundTranshuman || newResult > 4) {
          if (newResult !== 1 && (newResult === 6 || newResult + additionalToWound >= pass)) {
            const penetration = getPenetrationIncrease(attacker.penetrationWoundRule, newResult, hit.penetration);
            const damage = getResultDamage(attacker.damageCharacteristicWoundRule, newResult, hit.damage);
            mortalWounds.push(getMortalWounds(attacker.damageWoundRule, newResult));
            hits.push({ strength: hit.strength, penetration, damage });
          }
        }
      }
      continue;
    }

    if (result !== 1 && (result === 6 || result + additionalToWound >= pass)) {
      const penetration = getPenetrationIncrease(attacker.penetrationWoundRule, result, hit.penetration);
      const damage = getResultDamage(attacker.damageCharacteristicWoundRule, result, hit.damage);
      mortalWounds.push(getMortalWounds(attacker.damageWoundRule, result));
      hits.push({ strength: hit.strength, penetration, damage });
    } else if (canReroll(attacker.woundRerollRule, result, rerollState)) {
      const newResult = evalValue(d6);
      if (newResult !== 1 && (newResult === 6 || newResult + additionalToWound >= pass)) {
        const penetration = getPenetrationIncrease(attacker.penetrationWoundRule, newResult, hit.penetration);
        const damage = getResultDamage(attacker.damageCharacteristicWoundRule, newResult, hit.damage);
        mortalWounds.push(getMortalWounds(attacker.damageWoundRule, newResult));
        hits.push({ strength: hit.strength, penetration, damage });
      }
    }
  }

  return {
    mortalWounds: mortalWounds.filter((x) => !(x.kind === "simple" && x.value === 0)),
    hits
  };
}

function attackSequence(attacker: Attacker, defender: Defender): number {
  const attackResult = doHit(attacker, defender);
  const woundResult = doWound(attacker, attackResult, defender);
  return doSave(defender, woundResult);
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => b - a);
  const index = Math.ceil((p / 100) * sorted.length);
  return sorted[index - 1] ?? 0;
}

function percentiles(values: number[]) {
  return {
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99)
  };
}

type RerollRulesUi = "NO" | "ONES" | "SINGLE" | "ALL";
type ModificationRuleUi = "NO" | "ADD" | "REPLACE";

function uiToRerollRule(v: RerollRulesUi): RerollRule {
  switch (v) {
    case "NO":
      return { kind: "no" };
    case "ONES":
      return { kind: "ones" };
    case "ALL":
      return { kind: "full" };
    case "SINGLE":
      return { kind: "single" };
  }
}

function mkDamageCharacteristicRule(
  status: ModificationRuleUi,
  onResult: number,
  resultValue: Value
): DamageCharacteristicRule {
  if (status === "NO") return { kind: "no" };
  if (status === "ADD") return { kind: "additionalOnResult", onResult, additionalDamage: resultValue };
  return { kind: "onResult", onResult, damage: resultValue };
}

function mkPenetrationRule(status: ModificationRuleUi, onResult: number, resultValue: Value): PenetrationRule {
  if (status === "NO") return { kind: "no" };
  if (status === "ADD") return { kind: "additionalOnResult", onResult, additionalPenetration: resultValue };
  return { kind: "onResult", onResult, newPenetration: resultValue };
}

function mkStrengthHitRule(status: ModificationRuleUi, onResult: number, resultValue: Value): StrengthHitRule {
  if (status === "NO") return { kind: "no" };
  if (status === "ADD") return { kind: "additionalOnResult", onResult, additionalStrength: resultValue };
  return { kind: "onResult", onResult, newStrength: resultValue };
}

type UiState = {
  attacks: string;
  skill: string;
  strength: string;
  penetration: string;
  damage: string;

  additionalHitRule: boolean;
  additionalHitOn: string;
  additionalHits: string;

  autoHit: boolean;

  hRerollRule: RerollRulesUi;
  plusOneToH: boolean;

  damageOnHRule: ModificationRuleUi;
  damageOnHOn: string;
  damageOnH: string;

  mortalsOnHRule: boolean;
  mortalsOnHOn: string;
  mortalsOnH: string;

  hasAutoWoundRule: boolean;
  autoWoundOn: string;

  apOnHitRule: ModificationRuleUi;
  apOnHitOn: string;
  apOnHit: string;

  strengthOnHRule: ModificationRuleUi;
  strengthOnHOn: string;
  strengthOnH: string;

  wRerollRule: RerollRulesUi;
  plusOneToW: boolean;

  damageOnWRule: ModificationRuleUi;
  damageOnWOn: string;
  damageOnW: string;

  mortalsOnWRule: boolean;
  mortalsOnWOn: string;
  mortalsOnW: string;

  apOnWRule: ModificationRuleUi;
  apOnWOn: string;
  apOnW: string;

  hitTranshuman: boolean;
  woundTranshuman: boolean;
  toughness: string;
  save: string;
  hasInvulnerableSave: boolean;
  invulnerableSave: string;
  hasFeelNoPain: boolean;
  feelNoPain: string;
  hasDamageDecrease: boolean;
  damageDecrease: string;
};

function makeDefaultState(): UiState {
  return {
    attacks: "1",
    skill: "3",
    strength: "4",
    penetration: "0",
    damage: "1",

    additionalHitRule: false,
    additionalHitOn: "6",
    additionalHits: "1",

    autoHit: false,

    hRerollRule: "NO",
    plusOneToH: false,

    damageOnHRule: "NO",
    damageOnHOn: "6",
    damageOnH: "1",

    mortalsOnHRule: false,
    mortalsOnHOn: "6",
    mortalsOnH: "1",

    hasAutoWoundRule: false,
    autoWoundOn: "6",

    apOnHitRule: "NO",
    apOnHitOn: "6",
    apOnHit: "1",

    strengthOnHRule: "NO",
    strengthOnHOn: "6",
    strengthOnH: "1",

    wRerollRule: "NO",
    plusOneToW: false,

    damageOnWRule: "NO",
    damageOnWOn: "6",
    damageOnW: "1",

    mortalsOnWRule: false,
    mortalsOnWOn: "6",
    mortalsOnW: "1",

    apOnWRule: "NO",
    apOnWOn: "6",
    apOnW: "1",

    hitTranshuman: false,
    woundTranshuman: false,
    toughness: "4",
    save: "4",
    hasInvulnerableSave: false,
    invulnerableSave: "6",
    hasFeelNoPain: false,
    feelNoPain: "6",
    hasDamageDecrease: false,
    damageDecrease: "1"
  };
}

function buildModels(state: UiState): { attacker: Attacker; defender: Defender; iterations: number } {
  const iterations = DEFAULT_ITERATIONS;
  const attacks = parseValue(state.attacks);
  if (maxValue(attacks) > MAX_ATTACKS) {
    throw new Error(TOO_MANY_ATTACKS_MSG);
  }
  const skill = Number(state.skill);
  const strength = parseValue(state.strength);
  const penetration = parseValue(state.penetration);
  const damage = parseValue(state.damage);

  const additionalHitRule: AdditionalHitRule = state.additionalHitRule
    ? {
        kind: "onResult",
        onResult: Number(state.additionalHitOn),
        additionalHits: parseValue(state.additionalHits)
      }
    : { kind: "no" };
  if (additionalHitRule.kind === "onResult" && maxValue(additionalHitRule.additionalHits) > MAX_ADDITIONAL_HITS) {
    throw new Error(TOO_MANY_ADDITIONAL_HITS_MSG);
  }

  const autoHitRule: AutoHitRule = state.autoHit ? { kind: "always" } : { kind: "no" };
  const hitRerollRule = uiToRerollRule(state.hRerollRule);
  const damageCharacteristicHitRule = mkDamageCharacteristicRule(
    state.damageOnHRule,
    Number(state.damageOnHOn),
    parseValue(state.damageOnH)
  );
  const damageHitRule: DamageOnRollRule = state.mortalsOnHRule
    ? { kind: "onHit", onResult: Number(state.mortalsOnHOn), mortalWounds: parseValue(state.mortalsOnH) }
    : { kind: "no" };
  const autoWoundRule: AutoWoundRule = state.hasAutoWoundRule
    ? { kind: "onResult", onResult: Number(state.autoWoundOn) }
    : { kind: "no" };
  const penetrationHitRule = mkPenetrationRule(state.apOnHitRule, Number(state.apOnHitOn), parseValue(state.apOnHit));
  const strengthHitRule = mkStrengthHitRule(
    state.strengthOnHRule,
    Number(state.strengthOnHOn),
    parseValue(state.strengthOnH)
  );

  const woundRerollRule = uiToRerollRule(state.wRerollRule);
  const damageCharacteristicWoundRule = mkDamageCharacteristicRule(
    state.damageOnWRule,
    Number(state.damageOnWOn),
    parseValue(state.damageOnW)
  );
  const damageWoundRule: DamageOnRollRule = state.mortalsOnWRule
    ? { kind: "onHit", onResult: Number(state.mortalsOnWOn), mortalWounds: parseValue(state.mortalsOnW) }
    : { kind: "no" };
  const penetrationWoundRule = mkPenetrationRule(state.apOnWRule, Number(state.apOnWOn), parseValue(state.apOnW));

  const attacker: Attacker = {
    attacks,
    skill,
    strength,
    penetration,
    damage,

    additionalHitRule,
    autoHitRule,
    rerollRule: hitRerollRule,
    plusOneToHit: state.plusOneToH,
    damageCharacteristicHitRule,
    damageHitRule,
    autoWoundRule,
    penetrationHitRule,
    strengthHitRule,

    woundRerollRule,
    plusOneToWound: state.plusOneToW,
    damageCharacteristicWoundRule,
    damageWoundRule,
    penetrationWoundRule
  };

  const toughness = parseValue(state.toughness);
  const save = parseValue(state.save);
  const invulnerableSave = state.hasInvulnerableSave
    ? parseValue(state.invulnerableSave)
    : ({ kind: "simple", value: 7 } as const);
  const feelNoPain = state.hasFeelNoPain ? Number(state.feelNoPain) : 7;
  const damageDecrease = state.hasDamageDecrease ? parseValue(state.damageDecrease) : none;

  const defender: Defender = {
    hitTranshuman: state.hitTranshuman,
    woundTranshuman: state.woundTranshuman,
    toughness,
    save,
    invulnerableSave,
    feelNoPain,
    damageDecrease
  };

  return { attacker, defender, iterations };
}

function Field({
  label,
  children,
  hint
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="toolField">
      <div className="toolFieldLabel">
        <span className="toolFieldLabelText">{label}</span>
        {hint ? <span className="toolFieldHint">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

function StepperInput({
  value,
  onChange,
  belowOne = false,
  inputMode,
  spellCheck = false
}: {
  value: string;
  onChange: (v: string) => void;
  belowOne?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  spellCheck?: boolean;
}) {
  return (
    <div className="toolStepper">
      <button className="toolBtn" type="button" onClick={() => onChange(decrease(value, belowOne))}>
        −
      </button>
      <input
        className="toolInput"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={inputMode}
        spellCheck={spellCheck}
      />
      <button className="toolBtn" type="button" onClick={() => onChange(increase(value))}>
        +
      </button>
    </div>
  );
}

export function W40kCalculatorTool() {
  const [state, setState] = useState<UiState>(() => makeDefaultState());
  const [error, setError] = useState<string | null>(null);
  const [computing, setComputing] = useState(false);
  const [stats, setStats] = useState<string>("—");
  const [sampleLines, setSampleLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<number | null>(null);

  const pendingRef = useRef<number | null>(null);
  const runIdRef = useRef(0);

  const attackerDefenderPreview = useMemo(() => {
    try {
      setError(null);
      const { attacker, defender, iterations } = buildModels(state);
      return { attacker, defender, iterations };
    } catch (e) {
      return { attacker: null, defender: null, iterations: null, error: e instanceof Error ? e.message : "Invalid input." };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (pendingRef.current != null) {
      window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }

    if ("error" in attackerDefenderPreview && attackerDefenderPreview.error) {
      const msg = attackerDefenderPreview.error;
      if (msg === TOO_MANY_ATTACKS_MSG || msg === TOO_MANY_ADDITIONAL_HITS_MSG) {
        // Special case: show in Result (not as a red error), and clear previous output.
        setError(null);
        setStats(msg);
        setSampleLines([]);
      } else {
        setError(msg);
      }
      setComputing(false);
      setProgress(null);
      return;
    }

    const { attacker, defender, iterations } = attackerDefenderPreview as {
      attacker: Attacker;
      defender: Defender;
      iterations: number;
    };

    const runId = ++runIdRef.current;

    pendingRef.current = window.setTimeout(() => {
      setComputing(true);
      setError(null);
      setProgress(0);

      const wounds = new Array<number>(iterations);
      const sample: number[] = [];
      let i = 0;
      let total = 0;

      const chunkSize = 2000;

      const tick = () => {
        if (runIdRef.current !== runId) return; // cancelled by a new run

        const end = Math.min(i + chunkSize, iterations);
        for (; i < end; i++) {
          const w = attackSequence(attacker, defender);
          wounds[i] = w;
          total += w;
          if (sample.length < 5) sample.push(w);
        }

        setProgress(i / iterations);

        if (i < iterations) {
          requestAnimationFrame(tick);
          return;
        }

        const mean = total / wounds.length;
        const p = percentiles(wounds);

        setStats(
          `mean - ${formatFloat(mean)}W\n` +
            `p25 - ${p.p25}W\n` +
            `p50 - ${p.p50}W\n` +
            `p95 - ${p.p95}W\n` +
            `p99 - ${p.p99}W`
        );
        setSampleLines(sample.map((w, idx) => `#${idx + 1} - ${w}W`));
        setComputing(false);
        setProgress(null);
      };

      requestAnimationFrame(tick);
    }, 180);

    return () => {
      if (pendingRef.current != null) window.clearTimeout(pendingRef.current);
      // cancel in-flight run
      runIdRef.current += 1;
    };
  }, [attackerDefenderPreview]);

  function set<K extends keyof UiState>(key: K, value: UiState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="toolWrap" role="region" aria-label="W40K Calculator tool">
      <div className="toolTitle">
        <span className="kw">tool</span>
        <span style={{ margin: "0 8px", color: "var(--muted)" }}>→</span>
        <span className="fn">W40K Calculator</span>
      </div>

      <div className="w40kGrid">
        <div className="toolCard">
          <div className="toolCardTitle">Attacker</div>

          <div className="toolGrid2">
            <Field label="Attacks">
              <div className="toolStepper">
                <button className="toolBtn" type="button" onClick={() => set("attacks", decrease(state.attacks))}>
                  −
                </button>
                <input
                  className="toolInput"
                  value={state.attacks}
                  onChange={(e) => {
                    const next = e.target.value;
                    const trimmed = next.trim();
                    if (isDigitsOnly(trimmed)) {
                      const n = Number(trimmed);
                      set("attacks", String(Math.min(MAX_ATTACKS, Number.isFinite(n) ? n : 0)));
                    } else {
                      set("attacks", next);
                    }
                  }}
                  spellCheck={false}
                />
                <button
                  className="toolBtn"
                  type="button"
                  onClick={() => {
                    const next = increase(state.attacks);
                    const trimmed = next.trim();
                    if (isDigitsOnly(trimmed)) {
                      const n = Number(trimmed);
                      set("attacks", String(Math.min(MAX_ATTACKS, Number.isFinite(n) ? n : 0)));
                    } else {
                      set("attacks", next);
                    }
                  }}
                >
                  +
                </button>
              </div>
            </Field>

            <Field label={`Skill ${state.skill}+`}>
              <div className="toolStepper">
                <button className="toolBtn" type="button" onClick={() => set("skill", decrease(state.skill))}>
                  −
                </button>
                <input
                  className="toolInput"
                  value={state.skill}
                  onChange={(e) => set("skill", e.target.value)}
                  inputMode="numeric"
                  spellCheck={false}
                />
                <button className="toolBtn" type="button" onClick={() => set("skill", increase(state.skill))}>
                  +
                </button>
              </div>
            </Field>

            <Field label="Strength">
              <div className="toolStepper">
                <button className="toolBtn" type="button" onClick={() => set("strength", decrease(state.strength))}>
                  −
                </button>
                <input
                  className="toolInput"
                  value={state.strength}
                  onChange={(e) => set("strength", e.target.value)}
                  spellCheck={false}
                />
                <button className="toolBtn" type="button" onClick={() => set("strength", increase(state.strength))}>
                  +
                </button>
              </div>
            </Field>

            <Field label="Penetration">
              <div className="toolStepper">
                <button className="toolBtn" type="button" onClick={() => set("penetration", decrease(state.penetration, true))}>
                  −
                </button>
                <input
                  className="toolInput"
                  value={state.penetration}
                  onChange={(e) => set("penetration", e.target.value)}
                  spellCheck={false}
                />
                <button className="toolBtn" type="button" onClick={() => set("penetration", increase(state.penetration))}>
                  +
                </button>
              </div>
            </Field>

            <Field label="Damage">
              <div className="toolStepper">
                <button className="toolBtn" type="button" onClick={() => set("damage", decrease(state.damage))}>
                  −
                </button>
                <input
                  className="toolInput"
                  value={state.damage}
                  onChange={(e) => set("damage", e.target.value)}
                  spellCheck={false}
                />
                <button className="toolBtn" type="button" onClick={() => set("damage", increase(state.damage))}>
                  +
                </button>
              </div>
            </Field>

            <Field label="Auto hit">
              <label className="toolCheckRow">
                <input type="checkbox" checked={state.autoHit} onChange={(e) => set("autoHit", e.target.checked)} />
                <span>Enabled</span>
              </label>
            </Field>
          </div>

          <details className="toolDetails">
            <summary>Customize</summary>

            <div className="toolGrid2" style={{ marginTop: 10 }}>
              <Field label="Additional hits">
                <label className="toolCheckRow">
                  <input
                    type="checkbox"
                    checked={state.additionalHitRule}
                    onChange={(e) => set("additionalHitRule", e.target.checked)}
                  />
                  <span>Enabled</span>
                </label>
              {state.additionalHitRule ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.additionalHitOn}+`}>
                      <StepperInput value={state.additionalHitOn} onChange={(v) => set("additionalHitOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="Hits">
                      <StepperInput value={state.additionalHits} onChange={(v) => set("additionalHits", clampDigits(v, MAX_ADDITIONAL_HITS))} />
                    </Field>
                  </div>
                ) : null}
              </Field>

              <Field label="Hit reroll">
                <select className="toolSelect" value={state.hRerollRule} onChange={(e) => set("hRerollRule", e.target.value as RerollRulesUi)}>
                  <option value="NO">NO</option>
                  <option value="ONES">ONES</option>
                  <option value="SINGLE">SINGLE</option>
                  <option value="ALL">ALL</option>
                </select>
              </Field>

              <Field label="+1 to hit">
                <label className="toolCheckRow">
                  <input type="checkbox" checked={state.plusOneToH} onChange={(e) => set("plusOneToH", e.target.checked)} />
                  <span>Enabled</span>
                </label>
              </Field>

              <Field label="+D on hit">
                <select className="toolSelect" value={state.damageOnHRule} onChange={(e) => set("damageOnHRule", e.target.value as ModificationRuleUi)}>
                  <option value="NO">NO</option>
                  <option value="ADD">ADD</option>
                  <option value="REPLACE">REPLACE</option>
                </select>
                {state.damageOnHRule !== "NO" ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.damageOnHOn}+`}>
                      <StepperInput value={state.damageOnHOn} onChange={(v) => set("damageOnHOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="Damage">
                      <StepperInput value={state.damageOnH} onChange={(v) => set("damageOnH", v)} />
                    </Field>
                  </div>
                ) : null}
              </Field>

              <Field label="MW on hit">
                <label className="toolCheckRow">
                  <input type="checkbox" checked={state.mortalsOnHRule} onChange={(e) => set("mortalsOnHRule", e.target.checked)} />
                  <span>Enabled</span>
                </label>
                {state.mortalsOnHRule ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.mortalsOnHOn}+`}>
                      <StepperInput value={state.mortalsOnHOn} onChange={(v) => set("mortalsOnHOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="MW">
                      <StepperInput value={state.mortalsOnH} onChange={(v) => set("mortalsOnH", v)} />
                    </Field>
                  </div>
                ) : null}
              </Field>

              <Field label="Auto wound">
                <label className="toolCheckRow">
                  <input type="checkbox" checked={state.hasAutoWoundRule} onChange={(e) => set("hasAutoWoundRule", e.target.checked)} />
                  <span>Enabled</span>
                </label>
                {state.hasAutoWoundRule ? (
                  <Field label={`On ${state.autoWoundOn}+`}>
                    <StepperInput value={state.autoWoundOn} onChange={(v) => set("autoWoundOn", v)} inputMode="numeric" />
                  </Field>
                ) : null}
              </Field>

              <Field label="-AP on hit">
                <select className="toolSelect" value={state.apOnHitRule} onChange={(e) => set("apOnHitRule", e.target.value as ModificationRuleUi)}>
                  <option value="NO">NO</option>
                  <option value="ADD">ADD</option>
                  <option value="REPLACE">REPLACE</option>
                </select>
                {state.apOnHitRule !== "NO" ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.apOnHitOn}+`}>
                      <StepperInput value={state.apOnHitOn} onChange={(v) => set("apOnHitOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="AP">
                      <StepperInput value={state.apOnHit} onChange={(v) => set("apOnHit", v)} />
                    </Field>
                  </div>
                ) : null}
              </Field>

              <Field label="+S on hit">
                <select
                  className="toolSelect"
                  value={state.strengthOnHRule}
                  onChange={(e) => set("strengthOnHRule", e.target.value as ModificationRuleUi)}
                >
                  <option value="NO">NO</option>
                  <option value="ADD">ADD</option>
                  <option value="REPLACE">REPLACE</option>
                </select>
                {state.strengthOnHRule !== "NO" ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.strengthOnHOn}+`}>
                      <StepperInput value={state.strengthOnHOn} onChange={(v) => set("strengthOnHOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="Strength">
                      <StepperInput value={state.strengthOnH} onChange={(v) => set("strengthOnH", v)} />
                    </Field>
                  </div>
                ) : null}
              </Field>

              <Field label="Wound reroll">
                <select className="toolSelect" value={state.wRerollRule} onChange={(e) => set("wRerollRule", e.target.value as RerollRulesUi)}>
                  <option value="NO">NO</option>
                  <option value="ONES">ONES</option>
                  <option value="SINGLE">SINGLE</option>
                  <option value="ALL">ALL</option>
                </select>
              </Field>

              <Field label="+1 to wound">
                <label className="toolCheckRow">
                  <input type="checkbox" checked={state.plusOneToW} onChange={(e) => set("plusOneToW", e.target.checked)} />
                  <span>Enabled</span>
                </label>
              </Field>

              <Field label="+D on wound">
                <select className="toolSelect" value={state.damageOnWRule} onChange={(e) => set("damageOnWRule", e.target.value as ModificationRuleUi)}>
                  <option value="NO">NO</option>
                  <option value="ADD">ADD</option>
                  <option value="REPLACE">REPLACE</option>
                </select>
                {state.damageOnWRule !== "NO" ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.damageOnWOn}+`}>
                      <StepperInput value={state.damageOnWOn} onChange={(v) => set("damageOnWOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="Damage">
                      <StepperInput value={state.damageOnW} onChange={(v) => set("damageOnW", v)} />
                    </Field>
                  </div>
                ) : null}
              </Field>

              <Field label="MW on wound">
                <label className="toolCheckRow">
                  <input type="checkbox" checked={state.mortalsOnWRule} onChange={(e) => set("mortalsOnWRule", e.target.checked)} />
                  <span>Enabled</span>
                </label>
                {state.mortalsOnWRule ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.mortalsOnWOn}+`}>
                      <StepperInput value={state.mortalsOnWOn} onChange={(v) => set("mortalsOnWOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="MW">
                      <StepperInput value={state.mortalsOnW} onChange={(v) => set("mortalsOnW", v)} />
                    </Field>
                  </div>
                ) : null}
              </Field>

              <Field label="-AP on wound">
                <select className="toolSelect" value={state.apOnWRule} onChange={(e) => set("apOnWRule", e.target.value as ModificationRuleUi)}>
                  <option value="NO">NO</option>
                  <option value="ADD">ADD</option>
                  <option value="REPLACE">REPLACE</option>
                </select>
                {state.apOnWRule !== "NO" ? (
                  <div className="toolSubGrid">
                    <Field label={`On ${state.apOnWOn}+`}>
                      <StepperInput value={state.apOnWOn} onChange={(v) => set("apOnWOn", v)} inputMode="numeric" />
                    </Field>
                    <Field label="AP">
                      <StepperInput value={state.apOnW} onChange={(v) => set("apOnW", v)} />
                    </Field>
                  </div>
                ) : null}
              </Field>
            </div>
          </details>
        </div>

        <div className="toolCard">
          <div className="toolCardTitle">Defender</div>

          <div className="toolGrid2">
            <Field label="Toughness">
              <div className="toolStepper">
                <button className="toolBtn" type="button" onClick={() => set("toughness", decrease(state.toughness))}>
                  −
                </button>
                <input className="toolInput" value={state.toughness} onChange={(e) => set("toughness", e.target.value)} spellCheck={false} />
                <button className="toolBtn" type="button" onClick={() => set("toughness", increase(state.toughness))}>
                  +
                </button>
              </div>
            </Field>

            <Field label={`Save ${state.save}+`}>
              <div className="toolStepper">
                <button className="toolBtn" type="button" onClick={() => set("save", decrease(state.save))}>
                  −
                </button>
                <input className="toolInput" value={state.save} onChange={(e) => set("save", e.target.value)} spellCheck={false} />
                <button className="toolBtn" type="button" onClick={() => set("save", increase(state.save))}>
                  +
                </button>
              </div>
            </Field>

            <Field label="Hit transhuman">
              <label className="toolCheckRow">
                <input type="checkbox" checked={state.hitTranshuman} onChange={(e) => set("hitTranshuman", e.target.checked)} />
                <span>Enabled</span>
              </label>
            </Field>

            <Field label="Wound transhuman">
              <label className="toolCheckRow">
                <input type="checkbox" checked={state.woundTranshuman} onChange={(e) => set("woundTranshuman", e.target.checked)} />
                <span>Enabled</span>
              </label>
            </Field>

            <Field label="Has invulnerable save">
              <label className="toolCheckRow">
                <input
                  type="checkbox"
                  checked={state.hasInvulnerableSave}
                  onChange={(e) => set("hasInvulnerableSave", e.target.checked)}
                />
                <span>Enabled</span>
              </label>
              {state.hasInvulnerableSave ? (
                <Field label={`Inv. save ${state.invulnerableSave}++`}>
                  <StepperInput value={state.invulnerableSave} onChange={(v) => set("invulnerableSave", v)} />
                </Field>
              ) : null}
            </Field>

            <Field label="Has FNP">
              <label className="toolCheckRow">
                <input type="checkbox" checked={state.hasFeelNoPain} onChange={(e) => set("hasFeelNoPain", e.target.checked)} />
                <span>Enabled</span>
              </label>
              {state.hasFeelNoPain ? (
                <Field label={`FNP ${state.feelNoPain}+++`}>
                  <StepperInput value={state.feelNoPain} onChange={(v) => set("feelNoPain", v)} inputMode="numeric" />
                </Field>
              ) : null}
            </Field>

            <Field label="Has -Damage">
              <label className="toolCheckRow">
                <input
                  type="checkbox"
                  checked={state.hasDamageDecrease}
                  onChange={(e) => set("hasDamageDecrease", e.target.checked)}
                />
                <span>Enabled</span>
              </label>
              {state.hasDamageDecrease ? (
                <Field label="-Damage">
                  <StepperInput value={state.damageDecrease} onChange={(v) => set("damageDecrease", v)} />
                </Field>
              ) : null}
            </Field>
          </div>
        </div>
      </div>

      {/* Progress (shown right under Attacker/Defender) */}
      {computing ? (
        <div style={{ fontFamily: "var(--font-mono)", color: "rgba(223, 225, 229, 0.55)" }}>
          {`Computing… ${Math.min(99, Math.floor(((progress ?? 0) * 100) as number))}%`}
        </div>
      ) : null}

      {error ? <div className="toolError">{error}</div> : null}

      {!computing ? (
        <>
          <div className="toolCard">
            <div className="toolCardTitle">Statistics</div>
            <div className="toolResultMono">{stats}</div>
          </div>

          <div className="toolCard">
            <div className="toolCardTitle">Sample</div>
            <div className="toolResultMono">{sampleLines.length ? sampleLines.join("\n") : "—"}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}

