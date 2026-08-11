import { useEffect, useMemo, useState } from 'react';
import { money0 } from '../lib/format';
import { Money } from './Money';
import { HintPopover } from './HintPopover';
import { NARROW, useMediaQuery } from '../hooks/useMediaQuery';
import { tierAbbrev, type BuildCost, type CostEngine, type PricedLine } from '../lib/transmutes';

// Build Calculator (Phase 2 of the transmutes expansion plan). Pick one recipe,
// enter how many of each ingredient you already own, and the calculator shows
// what *finishing* the craft still costs — avg and min — plus the value of the
// materials you're bringing to it.
//
// Two design choices worth stating:
//  • Every line is treated uniformly, source included. "If you already own the
//    source" isn't a separate mode — it's just setting that line to Have-all,
//    which drops it out of the cost-to-finish. So the Recipes view's build/
//    upgrade split falls out of the on-hand math instead of being special-cased.
//  • Prices come straight from the same cost engine the Recipes view reads, so
//    the two can't drift. Any line's unit price can be overridden when the
//    market differs from our estimate (plan §3.2/§3.4) — the single general
//    tool that covers uncraftable relics, scarce URs and secondary divergence.
//
// State is ephemeral (plan Q4): on-hand counts and overrides live in React
// state, keyed by line index within the selected recipe, and reset when the
// recipe changes. No persistence in v1.

type Override = { avg: number | null; min: number | null };

// Compact provenance for one ingredient: its own season when it differs from
// the recipe's (several recipes pull the same-named token from multiple years),
// then where the price came from. Mirrors TransmuteRow's priceTag, trimmed.
function lineTag(l: PricedLine, recipeYear: number): string {
  const parts: string[] = [];
  if (l.nominalYear !== recipeYear) parts.push(String(l.nominalYear));
  if (l.isSource) parts.push('source · built');
  else if (l.source === 'auction') parts.push('auction');
  else if (l.source === 'offAuction') parts.push('non-auction item');
  else if (l.source === 'derived') parts.push('derived');
  else if (l.source === 'build') parts.push('built');
  else parts.push('no price');
  if (l.seasonMapped) parts.push(`from ${l.pricedYear}`);
  if (l.bound === 'ceiling') parts.push('ceiling');
  return parts.join(' · ');
}

export function BuildCalculator({ engine }: { engine: CostEngine }) {
  const narrow = useMediaQuery(NARROW);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [onHand, setOnHand] = useState<Record<string, number>>({});
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [editing, setEditing] = useState<string | null>(null);

  const all = useMemo(() => engine.allCosts(), [engine]);
  const cost = useMemo(
    () => (selectedKey ? all.find((c) => c.key === selectedKey) ?? null : null),
    [all, selectedKey],
  );

  // A fresh recipe starts with a clean slate — no on-hand carried over, no
  // stale overrides, no open editor.
  useEffect(() => {
    setOnHand({});
    setOverrides({});
    setEditing(null);
  }, [selectedKey]);

  // --- Picker (shown until a recipe is chosen) ---------------------------
  const q = search.trim().toLowerCase();
  const byYear = useMemo(() => {
    const matches = q
      ? all.filter((c) => c.displayName.toLowerCase().includes(q) || c.transmute.toLowerCase().includes(q))
      : all;
    const m = new Map<number, BuildCost[]>();
    for (const c of matches) {
      const bucket = m.get(c.year);
      if (bucket) bucket.push(c);
      else m.set(c.year, [c]);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]);
  }, [all, q]);

  if (!cost) {
    return (
      <div className="calc">
        <label className="search calc-search">
          <span className="sr-only">Search recipes</span>
          <input
            type="text"
            placeholder="Search recipes to build…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus={!narrow}
          />
        </label>
        {byYear.length === 0 ? (
          <p className="empty">No recipes match “{search}”.</p>
        ) : (
          <div className="calc-picker">
            {byYear.map(([year, costs]) => (
              <div key={year} className="calc-pgroup">
                <div className="calc-pyear">{year}</div>
                <ul className="calc-plist">
                  {costs.map((c) => (
                    <li key={c.key}>
                      <button type="button" className="calc-pick" onClick={() => setSelectedKey(c.key)}>
                        <span className="tchip" data-tier={c.level}>
                          <span aria-hidden="true">{narrow ? tierAbbrev(c.level) : c.level}</span>
                          <span className="sr-only">{c.level}</span>
                        </span>
                        <span className="calc-pname">{c.displayName}</span>
                        <span className="calc-pcost">
                          <b>{money0(c.fullAvg)}</b>
                          <span className="calc-min">min {money0(c.fullMin)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- Per-line + total math for the selected recipe ---------------------
  const keyOf = (i: number) => String(i);
  const rows = cost.lines.map((line, i) => {
    const key = keyOf(i);
    const req = line.quantity;
    const ov = overrides[key];
    const unitAvg = ov ? ov.avg : line.unitAvg;
    const unitMin = ov ? ov.min : line.unitMin;
    const overridden = !!ov && (ov.avg !== line.unitAvg || ov.min !== line.unitMin);
    const have = Math.min(Math.max(0, onHand[key] ?? 0), req);
    const needed = Math.max(0, req - have);
    const priced = unitAvg != null;
    return {
      key, line, required: req,
      have, needed, overridden,
      unitAvg, unitMin, priced,
      finishAvg: unitAvg == null ? null : needed * unitAvg,
      finishMin: unitMin == null ? null : needed * unitMin,
      haveAvg: unitAvg == null ? null : Math.min(have, req) * unitAvg,
      haveMin: unitMin == null ? null : Math.min(have, req) * unitMin,
    };
  });

  const sum = (pick: (r: (typeof rows)[number]) => number | null) =>
    rows.reduce((n, r) => n + (pick(r) ?? 0), 0);
  const finishAvg = sum((r) => r.finishAvg);
  const finishMin = sum((r) => r.finishMin);
  const provideAvg = sum((r) => r.haveAvg);
  const fullAvg = sum((r) => (r.unitAvg == null ? null : r.required * r.unitAvg));
  const fullMin = sum((r) => (r.unitMin == null ? null : r.required * r.unitMin));
  // Lines you still need but that carry no price at all — excluded from the
  // total, so the headline is honest about being incomplete.
  const unpricedNeeded = rows.filter((r) => r.needed > 0 && !r.priced).length;
  const nothingOwned = rows.every((r) => r.have === 0);

  // --- On-hand + override mutators ---------------------------------------
  const setHave = (key: string, req: number, next: number) =>
    setOnHand((p) => ({ ...p, [key]: Math.min(Math.max(0, next), req) }));
  const toggleHaveAll = (key: string, req: number, have: number) =>
    setHave(key, req, have >= req ? 0 : req);

  const setOverrideField = (key: string, line: PricedLine, field: keyof Override, valueStr: string) =>
    setOverrides((p) => {
      const cur = p[key] ?? { avg: line.unitAvg, min: line.unitMin };
      const t = valueStr.trim();
      const num = t === '' ? null : Number(t);
      return { ...p, [key]: { ...cur, [field]: num != null && isFinite(num) ? num : null } };
    });
  const clearOverride = (key: string) =>
    setOverrides((p) => {
      const { [key]: _drop, ...rest } = p;
      return rest;
    });

  const src = cost.lines.find((l) => l.isSource);

  return (
    <div className="calc">
      {/* Selected recipe + the headline result. */}
      <div className="calc-head">
        <div className="calc-recipe">
          <span className="tchip" data-tier={cost.level}>
            <span aria-hidden="true">{narrow ? tierAbbrev(cost.level) : cost.level}</span>
            <span className="sr-only">{cost.level}</span>
          </span>
          <span className="calc-title">{cost.displayName}</span>
          <span className="calc-year">{cost.year}</span>
          <button type="button" className="calc-change" onClick={() => setSelectedKey(null)}>
            Change recipe
          </button>
        </div>

        <div className="calc-result">
          <div className="calc-headline">
            <span className="calc-hlab">Cost to finish</span>
            <span className="calc-hval"><b><Money value={finishAvg} /></b></span>
            <span className="calc-hmin">min <Money value={finishMin} /></span>
          </div>
          <div className="calc-sub">
            {nothingOwned ? (
              <span>
                Enter what you already own below to see what's left to buy. Full build from scratch:{' '}
                <b>{money0(fullAvg)}</b> <span className="calc-min">min {money0(fullMin)}</span>.
              </span>
            ) : (
              <span>
                You're providing <b>{money0(provideAvg)}</b> of materials · full build from scratch is{' '}
                {money0(fullAvg)}.
              </span>
            )}
          </div>
          {unpricedNeeded > 0 && (
            <p className="calc-warn">
              {unpricedNeeded} ingredient{unpricedNeeded === 1 ? '' : 's'} you still need
              {unpricedNeeded === 1 ? ' has' : ' have'} no price and {unpricedNeeded === 1 ? "isn't" : "aren't"} in
              the total.
            </p>
          )}
          {cost.marketAvg != null && (
            <p className="calc-buy">
              This token also sells at auction for about {money0(cost.marketAvg)}
              {finishAvg <= cost.marketAvg
                ? ` — finishing the craft (${money0(finishAvg)}) is cheaper.`
                : ` — cheaper than the ${money0(finishAvg)} left to build.`}
            </p>
          )}
        </div>
      </div>

      {/* Ingredient lines with on-hand entry. */}
      <ul className="calc-lines">
        {rows.map((r) => (
          <li key={r.key} className={`calc-line${r.line.isSource ? ' src' : ''}${r.needed === 0 ? ' covered' : ''}`}>
            <div className="calc-line-top">
              <span className="calc-ing">
                <span className="calc-good">{r.required} × {r.line.displayName}</span>
                <span className="calc-tag">
                  {lineTag(r.line, cost.year)}
                  {r.overridden && ' · your price'}
                </span>
              </span>
              <span className="calc-fin">
                {!r.priced ? (
                  <span className="calc-nostat">no price</span>
                ) : r.needed > 0 ? (
                  <>
                    <span className="calc-buyn">buy {r.needed}</span>
                    <b><Money value={r.finishAvg} /></b>
                    <span className="calc-min">min <Money value={r.finishMin} /></span>
                  </>
                ) : (
                  <span className="calc-covered">✓ covered</span>
                )}
              </span>
            </div>

            <div className="calc-line-ctl">
              <div className="stepper" role="group" aria-label={`On hand: ${r.line.displayName}`}>
                <button type="button" aria-label="One fewer" disabled={r.have <= 0}
                  onClick={() => setHave(r.key, r.required, r.have - 1)}>−</button>
                <input
                  type="number" min={0} max={r.required} inputMode="numeric"
                  aria-label={`On hand: ${r.line.displayName}`}
                  value={r.have}
                  onChange={(e) => setHave(r.key, r.required, e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0)}
                />
                <button type="button" aria-label="One more" disabled={r.have >= r.required}
                  onClick={() => setHave(r.key, r.required, r.have + 1)}>+</button>
              </div>
              <span className="calc-of">of {r.required} on hand</span>
              {r.required > 1 && (
                <button type="button" className={`calc-haveall${r.have >= r.required ? ' on' : ''}`}
                  aria-pressed={r.have >= r.required}
                  onClick={() => toggleHaveAll(r.key, r.required, r.have)}>
                  Have all
                </button>
              )}
              <span className="calc-unit">
                @ {money0(r.unitAvg)} ea
                <button type="button" className="calc-edit" aria-expanded={editing === r.key}
                  onClick={() => setEditing((e) => (e === r.key ? null : r.key))}>
                  {r.overridden ? 'edit price' : 'set price'}
                </button>
              </span>
            </div>

            {editing === r.key && (
              <div className="calc-override">
                <label>
                  avg
                  <input type="number" min={0} inputMode="decimal"
                    value={r.unitAvg ?? ''}
                    onChange={(e) => setOverrideField(r.key, r.line, 'avg', e.target.value)} />
                </label>
                <label>
                  min
                  <input type="number" min={0} inputMode="decimal"
                    value={r.unitMin ?? ''}
                    onChange={(e) => setOverrideField(r.key, r.line, 'min', e.target.value)} />
                </label>
                {r.overridden && (
                  <button type="button" className="calc-reset" onClick={() => clearOverride(r.key)}>
                    Reset to {money0(r.line.unitAvg)}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {src && (
        <p className="calc-foot">
          <HintPopover label="About the source token" trigger={<span className="calc-foot-trig">Already own the {src.displayName}?</span>}>
            Set the source line to “Have all” to price just the upgrade step — the same “if you own
            the source” total the Recipes view shows.
          </HintPopover>
        </p>
      )}
    </div>
  );
}
