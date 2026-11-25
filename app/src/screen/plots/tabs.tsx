"use client";

/**
 * The drawer's tabs. Each asks the engine for what it draws, and only while
 * it is open: Forces and Potential the force cuts (and the dipole overlay on
 * request), Radiation the pattern. Heating and Spectrum draw from the result
 * the strip already has; Sweep runs one solve per value, on demand.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Engine } from "../../engine/client.ts";
import { isAbortError } from "../../engine/client.ts";
import type { LensResult, Result, Setup } from "../../engine/types.ts";
import { formatNumber, formatSci, formatSI } from "../../lib/format.ts";
import { toFieldText } from "../../lib/units.ts";
import { answerFromError } from "../answer.ts";
import { useAnswer } from "../hooks.ts";
import { canonical, environmentOf, pressureText, subscript } from "../model.ts";
import { NumberField, SelectField } from "../ui/fields.tsx";
import ui from "../ui/ui.module.css";
import { axisCuts, harmonic, heatingCurves, polarCut, potential } from "./data.ts";
import { Plot, type PlotSeries, type Tone } from "./Plot.tsx";
import { PolarPlot } from "./PolarPlot.tsx";
import { spectrum } from "./spectrum.ts";
import { waveRange, wavefrontPixels, weightedRms } from "./wavefront.ts";
import { defaultRange, followFrom, jumpsAt, logByDefault, OUTPUTS, sweepParams, sweepValues, unstableRuns } from "./sweep.ts";
import styles from "./tabs.module.css";

export interface TabProps {
  setup: Setup;
  engine: (() => Engine) | null;
  /** use the presets' recorded results */
  recorded: boolean;
}

const tone = (name: string): Tone => (name === "x" || name === "y" || name === "z" ? name : "ink");

/** A tab with nothing to draw says why, in a sentence. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.note} data-testid="tab-note">
      <p className={styles.noteTitle}>{title}</p>
      <p className={styles.noteText}>{children}</p>
    </div>
  );
}

/** What a tab shows while its data is on the way, or when it cannot have it. */
function waiting(title: string, answer: ReturnType<typeof useAnswer>, what: string): ReactNode | null {
  if (answer.answer.result) return null;
  if (answer.answer.notice) return <Note title={title}>{answer.answer.notice.text}</Note>;
  return (
    <Note title={title}>
      <span className={styles.busy}>Computing {what}…</span>
    </Note>
  );
}

// --- Forces -----------------------------------------------------------------------------

export function ForcesTab({ setup, engine, recorded }: TabProps) {
  const [dipole, setDipole] = useState(false);
  const light = setup.trap.fields.some((f) => f.kind === "beam");
  const solving = useAnswer(setup, engine, recorded, dipole && light ? ["dipole"] : ["curves"]);
  const wait = waiting("Forces", solving, dipole ? "the force in the dipole approximation" : "the force curves");
  const result = solving.answer.result;
  const toggle = light && (
    <label className={styles.check}>
      <input type="checkbox" checked={dipole} onChange={(e) => setDipole(e.target.checked)} data-testid="forces-dipole" />
      Dipole approximation
    </label>
  );
  if (wait || !result) return wait;
  const cuts = axisCuts(result);
  if (!cuts.length) return <Note title="Forces">The force curves were not computed for this result.</Note>;
  const series: PlotSeries[] = cuts.flatMap((c) => [
    { id: c.name, label: `along ${c.name}`, tone: tone(c.name), points: c.s.map((s, i) => [s, c.force[i]] as [number, number]) },
    ...(c.dipole ? [{ id: `${c.name}-dipole`, label: `along ${c.name}, dipole`, tone: tone(c.name), dashed: true, points: c.s.map((s, i) => [s, c.dipole![i]] as [number, number]) }] : []),
  ]);
  return (
    <div className={styles.tab} data-pending={solving.pending || undefined}>
      <Plot
        id="forces"
        title={dipole ? "Force along each eigen-axis: Mie theory, and the dipole approximation dashed" : "Force along each eigen-axis, through the equilibrium"}
        x={{ label: "Displacement from the equilibrium", unit: "m" }}
        y={{ label: "Force", unit: "N" }}
        series={series}
        at="from the equilibrium"
        dashed="dipole approximation"
        controls={toggle}
      />
    </div>
  );
}

// --- Potential ----------------------------------------------------------------------------

export function PotentialTab({ setup, engine, recorded }: TabProps) {
  const solving = useAnswer(setup, engine, recorded, ["curves"]);
  const wait = waiting("Potential", solving, "the force curves");
  const result = solving.answer.result;
  if (wait || !result) return wait;
  const T = environmentOf(setup).temperature;
  const cuts = axisCuts(result);
  if (!cuts.length) return <Note title="Potential">The force curves were not computed for this result.</Note>;
  const series: PlotSeries[] = cuts.flatMap((c) => {
    const U = potential(c.s, c.force, T);
    const out: PlotSeries[] = [{ id: c.name, label: `along ${c.name}`, tone: tone(c.name), points: c.s.map((s, i) => [s, U[i]] as [number, number]) }];
    if (c.stiffness && c.stiffness > 0) {
      const H = harmonic(c.s, c.stiffness, T);
      out.push({ id: `${c.name}-harmonic`, label: `along ${c.name}, harmonic`, tone: tone(c.name), dashed: true, points: c.s.map((s, i) => [s, H[i]] as [number, number]) });
    }
    return out;
  });
  return (
    <div className={styles.tab} data-pending={solving.pending || undefined}>
      <Plot
        id="potential"
        title={`Potential along each eigen-axis in k_BT at ${formatNumber(T, 3, true)} K; the harmonic trap of the same stiffness dashed`}
        x={{ label: "Displacement from the equilibrium", unit: "m" }}
        y={{ label: "Potential", unit: "", display: { unit: "k_BT", factor: 1 } }}
        series={series}
        fitTo={cuts.map((c) => c.name)}
        dashed="harmonic, same stiffness"
        at="from the equilibrium"
      />
    </div>
  );
}

// --- Heating --------------------------------------------------------------------------------

export function HeatingTab({ setup, result }: { setup: Setup; result: Result | null }) {
  const [table, setTable] = useState(false);
  if (!result) return <Note title="Heating">The heating rates appear here once the trap is computed.</Note>;
  const h = heatingCurves(result, setup);
  if (!h || !h.modes.length) {
    return <Note title="Heating">{result.rates ? "There is no stable trap: no mode to heat." : "Heating rates are computed for traps with a beam. This trap has no light."}</Note>;
  }
  const env = environmentOf(setup);
  const series: PlotSeries[] = h.modes.flatMap((m) => [
    { id: m.name, label: `along ${m.name}`, tone: tone(m.name), points: h.pressure.map((p, i) => [p, m.total[i]] as [number, number]) },
    { id: `${m.name}-recoil`, label: `along ${m.name}, recoil alone`, tone: tone(m.name), dashed: true, points: [[h.pressure[0], m.recoil] as [number, number], [h.pressure[h.pressure.length - 1], m.recoil] as [number, number]] },
  ]);
  const toggle = (
    <button type="button" className={ui.button} aria-pressed={table} onClick={() => setTable((t) => !t)} data-testid="heating-rates-toggle">
      {table ? "Against pressure" : `At ${pressureText(env.pressure)}`}
    </button>
  );
  if (table) return <HeatingTable setup={setup} result={result} toggle={toggle} />;
  return (
    <div className={styles.tab} data-testid="heating">
      <Plot
        id="heating"
        title={`Reheating against the pressure of ${subscript(env.gas)} at ${formatNumber(env.temperature, 3, true)} K; dots where photon recoil and the gas heat equally`}
        x={{ label: "Pressure", unit: "Pa", log: true, display: { unit: "mbar", factor: 100 } }}
        y={{ label: "Reheating", unit: "", log: true, display: { unit: "phonons/s", factor: 1 } }}
        series={series}
        fitTo={h.modes.map((m) => m.name)}
        dashed="photon recoil alone"
        markers={[{ x: h.now, label: `now: ${pressureText(h.now)}` }]}
        dots={h.modes
          .filter((m) => m.crossover != null)
          .map((m) => ({ x: m.crossover!, y: 2 * m.recoil, tone: tone(m.name), label: `along ${m.name}: recoil exceeds gas heating below ${pressureText(m.crossover!)}` }))}
        controls={toggle}
      />
    </div>
  );
}

/** The rates at the setup's pressure, as before D5. */
function HeatingTable({ setup, result, toggle }: { setup: Setup; result: Result; toggle: ReactNode }) {
  const rates = result.rates!;
  const env = environmentOf(setup);
  return (
    <div className={styles.heating} data-testid="heating">
      <div className={styles.heatingHead}>
        <p className={styles.heatingTitle}>
          Heating rates in phonons per second, at {pressureText(env.pressure)} of {subscript(env.gas)} and {formatNumber(env.temperature, 3, true)} K
        </p>
        {toggle}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Axis</th>
              <th scope="col">Gas collisions</th>
              <th scope="col">Photon recoil</th>
              <th scope="col">Total</th>
              <th scope="col">Oscillations before one phonon</th>
              <th scope="col">Recoil exceeds gas below</th>
            </tr>
          </thead>
          <tbody>
            {rates.modes.map((m) => (
              <tr key={m.name}>
                <th scope="row">
                  <span className={styles.key} data-axis={m.name} aria-hidden="true" /> {m.name}
                </th>
                <td>{formatSci(m.gas_heating)}</td>
                <td>{formatSci(m.recoil_heating)}</td>
                <td>{formatSci(m.reheating)}</td>
                <td>{formatSci(m.coherent_oscillations)}</td>
                <td>{m.crossover_pressure == null ? "—" : `${toFieldText(m.crossover_pressure, "pressure", "mbar", 2)} mbar`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Spectrum --------------------------------------------------------------------------------

export function SpectrumTab({ setup, result }: { setup: Setup; result: Result | null }) {
  const [table, setTable] = useState(false);
  // feedback damping, as the linewidth it adds, γ_fb / 2π [Hz]; the same on every mode
  const [feedback, setFeedback] = useState(0);
  if (!result) return <Note title="Spectrum">The spectrum appears here once the trap is computed.</Note>;
  const s = spectrum(result, 2 * Math.PI * feedback);
  if (!s) {
    return <Note title="Spectrum">{result.rates ? "There is no stable trap: no mode to oscillate." : "The spectrum needs the heating rates, which are computed for traps with a beam. This trap has no light."}</Note>;
  }
  const env = environmentOf(setup);
  const controls = (
    <div className={styles.sweepControls} data-testid="spectrum-controls">
      <NumberField
        id="spectrum-feedback"
        label="Feedback damping γ_fb/2π"
        value={feedback}
        quantity="frequency"
        unit="Hz"
        check={(v) => (v >= 0 ? null : "0 or more: feedback damps.")}
        onCommit={setFeedback}
      />
      <button type="button" className={ui.button} aria-pressed={table} onClick={() => setTable((t) => !t)} data-testid="spectrum-table-toggle">
        {table ? "Spectrum" : "Occupation"}
      </button>
    </div>
  );
  const cooled = feedback > 0 ? `, feedback adding ${toFieldText(feedback, "frequency", "Hz", 3)} Hz of linewidth` : "";
  if (table) {
    return (
      <div className={styles.heating} data-testid="spectrum">
        <div className={styles.heatingHead}>
          <p className={styles.heatingTitle}>
            Each mode in its steady state at {pressureText(env.pressure)} and {formatNumber(env.temperature, 3, true)} K{cooled}
          </p>
        </div>
        {controls}
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Axis</th>
                <th scope="col">Frequency</th>
                <th scope="col">Linewidth γ/2π</th>
                <th scope="col">Phonons</th>
                <th scope="col">T_eff</th>
                <th scope="col">rms displacement</th>
              </tr>
            </thead>
            <tbody>
              {s.modes.map((m) => (
                <tr key={m.name} data-testid={`spectrum-row-${m.name}`}>
                  <th scope="row">
                    <span className={styles.key} data-axis={m.name} aria-hidden="true" /> {m.name}
                  </th>
                  <td>{formatSI(m.frequency, "Hz")}</td>
                  <td>{formatSI(m.linewidth, "Hz")}</td>
                  <td>{formatSci(m.occupation)}</td>
                  <td>{formatSI(m.temperature, "K")}</td>
                  <td>{formatSI(m.rms, "m")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  const series: PlotSeries[] = s.modes.map((m) => ({ id: m.name, label: `along ${m.name}`, tone: tone(m.name), points: s.frequency.map((f, i) => [f, m.psd[i]] as [number, number]) }));
  return (
    <div className={styles.tab} data-testid="spectrum">
      <Plot
        id="spectrum"
        title={`Displacement spectrum at ${pressureText(env.pressure)}${cooled}; each peak's area is k_BT_eff/(mΩ²)`}
        x={{ label: "Frequency", unit: "Hz" }}
        y={{ label: "Displacement PSD", unit: "m²/Hz", log: true, display: { unit: "m²/Hz", factor: 1 } }}
        series={series}
        markers={s.modes.map((m) => ({ x: m.frequency, label: `${m.name}: ${formatSI(m.frequency, "Hz", 3)}, T_eff ${formatSI(m.temperature, "K", 3)}` }))}
        controls={controls}
      />
    </div>
  );
}

// --- Wavefront --------------------------------------------------------------------------------

export function WavefrontTab({ setup, engine, recorded }: TabProps) {
  const realLens = setup.trap.fields.some((f) => f.kind === "beam" && f.focus.kind === "asphere");
  const solving = useAnswer(setup, engine, recorded, ["lens"], realLens);
  if (!realLens) return <Note title="Wavefront">The wavefront error is traced for a real lens: choose Lens → Type → Asphere 354330-C.</Note>;
  const wait = waiting("Wavefront", solving, "the rays through the lens");
  const lenses = (solving.answer.result?.lenses ?? []).filter((l) => l.wavefront);
  if (wait) return wait;
  if (!lenses.length) return <Note title="Wavefront">The wavefront was not traced for this result.</Note>;
  return (
    <div className={styles.wavefronts} data-pending={solving.pending || undefined} data-testid="wavefront">
      {lenses.map((l) => (
        <WavefrontMap key={l.field} lens={l} name={lenses.length > 1 ? `Lens ${l.field + 1}` : "The lens"} />
      ))}
    </div>
  );
}

function WavefrontMap({ lens, name }: { lens: LensResult; name: string }) {
  const wf = lens.wavefront!;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const range = waveRange(wf);
  const rms = weightedRms(wf);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const img = wavefrontPixels(wf, range);
    const off = document.createElement("canvas");
    off.width = img.width;
    off.height = img.height;
    off.getContext("2d")!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = true;
    // y up: the first row of the map at the bottom
    ctx.save();
    ctx.translate(0, c.height);
    ctx.scale(1, -1);
    ctx.drawImage(off, 0, 0, c.width, c.height);
    ctx.restore();
  }, [wf, range]);
  const half = (wf.x[wf.x.length - 1] - wf.x[0]) / 2;
  return (
    <figure className={styles.wavefrontFigure}>
      <canvas ref={canvas} width={240} height={240} className={styles.wavefrontCanvas} role="img" aria-label={`${name}: wavefront error map, rms ${formatNumber(rms, 3)} waves`} data-testid={`wavefront-map-${lens.field}`} />
      <figcaption className={styles.wavefrontCaption}>
        <p className={styles.noteTitle}>{name}: wavefront error about its best focus</p>
        <p className={styles.noteText}>
          Across the beam on the lens, ±{formatSI(half, "m", 2, true)} (x right, y up): how far each ray&apos;s wave runs ahead of (red) or behind (blue) a perfect
          spherical wave converging on the focus. Tilt and defocus are taken out: the focus moved instead.
        </p>
        <dl className={styles.wavefrontNumbers} data-testid={`wavefront-numbers-${lens.field}`}>
          <dt>rms</dt>
          <dd>{formatNumber(rms, 3)} λ</dd>
          <dt>scale</dt>
          <dd>
            <span className={styles.wavefrontScale} aria-hidden="true" /> −{formatNumber(range, 2)} to +{formatNumber(range, 2)} λ
          </dd>
        </dl>
        <p className={styles.noteText}>The rms is weighted by the beam&apos;s intensity, as in the lens&apos;s readout; the map shows where the beam is above 1 % of its peak.</p>
      </figcaption>
    </figure>
  );
}

// --- Radiation -------------------------------------------------------------------------------

export function RadiationTab({ setup, engine, recorded }: TabProps) {
  const light = setup.trap.fields.some((f) => f.kind === "beam");
  const solving = useAnswer(setup, engine, recorded, ["pattern"], light);
  type View = "pattern" | "collection" | "information";
  const [view, setView] = useState<View>("pattern");
  if (!light) return <Note title="Radiation">There is no light in this trap, so nothing is scattered.</Note>;
  const wait = waiting("Radiation", solving, "the radiation pattern");
  const pattern = solving.answer.result?.pattern;
  if (wait) return wait;
  if (!pattern) return <Note title="Radiation">The radiation pattern was not computed for this result.</Note>;
  const { theta, phi } = pattern.grid;
  const choose = (
    <SelectField<View>
      id="radiation-view"
      label="Show"
      value={view}
      options={[
        { value: "pattern", label: "Where the light goes" },
        { value: "collection", label: "Light collected against NA" },
        { value: "information", label: "Position information against NA" },
      ]}
      onChange={setView}
    />
  );
  if (view === "pattern") {
    const xz = polarCut(theta, phi, pattern.scattered, "xz");
    const yz = polarCut(theta, phi, pattern.scattered, "yz");
    return (
      <div className={styles.tab} data-pending={solving.pending || undefined}>
        <PolarPlot
          id="radiation"
          title="Scattered power per solid angle, in two planes through the beam axis (z, up)"
          unit="W/sr"
          series={[
            { id: "xz", label: "x-z plane", tone: "x", angle: xz.angle, value: xz.value },
            { id: "yz", label: "y-z plane", tone: "y", angle: yz.angle, value: yz.value },
          ]}
          controls={choose}
        />
      </div>
    );
  }
  const NA = pattern.NA;
  const series: PlotSeries[] =
    view === "collection"
      ? [
          { id: "forward", label: "forward (+z)", tone: "a", points: NA.map((na, i) => [na, pattern.collection.forward[i]] as [number, number]) },
          { id: "backward", label: "backward (−z)", tone: "b", points: NA.map((na, i) => [na, pattern.collection.backward[i]] as [number, number]) },
        ]
      : (["x", "y", "z"] as const).map((ax) => ({
          id: ax,
          label: `${ax}, backward`,
          tone: ax,
          points: NA.map((na, i) => [na, pattern.information_efficiency.backward[ax][i]] as [number, number]),
        }));
  return (
    <div className={styles.tab} data-pending={solving.pending || undefined}>
      <Plot
        id="radiation"
        title={
          view === "collection"
            ? "Fraction of the scattered power a lens of each NA collects"
            : "Fraction of the position information a backward lens collects (Tebbenjohanns et al., PRA 100, 043821)"
        }
        x={{ label: "Collection NA", unit: "" }}
        y={{ label: view === "collection" ? "Collected" : "Information collected", unit: "" }}
        series={series}
        markers={pattern.trap_NA ? [{ x: pattern.trap_NA, label: `trapping lens: NA ${formatNumber(pattern.trap_NA, 2, true)}` }] : []}
        controls={choose}
      />
    </div>
  );
}

// --- Sweep -------------------------------------------------------------------------------------

interface SweepRun {
  key: string;
  param: string;
  output: string;
  xs: number[];
  /** per value: the result, or null if it failed */
  results: (Result | null)[];
  done: boolean;
  error?: string;
}

export function SweepTab({ setup, engine }: TabProps) {
  const params = sweepParams(setup);
  const [paramId, setParamId] = useState(params[0]?.id ?? "");
  const param = params.find((p) => p.id === paramId) ?? params[0];
  const [range, setRange] = useState<Record<string, [number, number]>>({});
  const [from, to] = range[param.id] ?? defaultRange(param, setup);
  const [count, setCount] = useState(13);
  const [log, setLog] = useState<Record<string, boolean>>({});
  // log spacing starts on only over a decade or more (#72); the box overrides it
  const isLog = log[param.id] ?? logByDefault(from, to);
  const [outputId, setOutputId] = useState("frequencies");
  const output = OUTPUTS.find((o) => o.id === outputId)!;
  const [follow, setFollow] = useState(true);
  const [run, setRun] = useState<SweepRun | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const setupKey = canonical(setup);

  // a sweep belongs to its setup: a new setup stops it and clears it
  useEffect(() => {
    return () => ctrl.current?.abort();
  }, [setupKey]);
  if (run && !run.key.startsWith(`${setupKey}|`)) setRun(null);

  if (!engine) return <Note title="Sweep">This preview has no engine, so it cannot sweep.</Note>;

  const start = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    const xs = sweepValues(from, to, count, isLog);
    const key = `${setupKey}|${param.id}|${from}|${to}|${count}|${isLog}`;
    const results: (Result | null)[] = [];
    setRun({ key, param: param.id, output: outputId, xs, results: [], done: false });
    for (const v of xs) {
      if (c.signal.aborted) return;
      try {
        // continuation: start from the last stable equilibrium, so the sweep follows one trap
        results.push(await engine().solve(param.set(setup, v), [], { signal: c.signal, start: follow ? followFrom(results) : null }));
      } catch (err) {
        if (isAbortError(err)) return;
        // one value the engine refuses does not end the sweep: it is a gap
        results.push(null);
        if (results.length === 1) setRun((r) => r && { ...r, error: answerFromError(err, param.set(setup, v)).notice?.text });
      }
      setRun((r) => (r && r.key === key ? { ...r, results: [...results] } : r));
    }
    setRun((r) => (r && r.key === key ? { ...r, done: true } : r));
  };
  const cancel = () => {
    ctrl.current?.abort();
    setRun((r) => r && { ...r, done: true });
  };

  const running = run !== null && !run.done;
  const controls = (
    <div className={styles.sweepControls} data-testid="sweep-controls">
      <SelectField id="sweep-param" label="Sweep" value={param.id} options={params.map((p) => ({ value: p.id, label: p.label }))} onChange={setParamId} />
      <NumberField
        key={`${param.id}-from`}
        id="sweep-from"
        label="From"
        value={from}
        quantity={param.quantity}
        unit={param.unit}
        check={param.check}
        onCommit={(v) => setRange((r) => ({ ...r, [param.id]: [v, to] }))}
      />
      <NumberField
        key={`${param.id}-to`}
        id="sweep-to"
        label="To"
        value={to}
        quantity={param.quantity}
        unit={param.unit}
        check={param.check}
        onCommit={(v) => setRange((r) => ({ ...r, [param.id]: [from, v] }))}
      />
      <NumberField
        id="sweep-count"
        label="Points"
        value={count}
        quantity="number"
        check={(v) => (v >= 2 && v <= 60 && Number.isInteger(v) ? null : "A whole number from 2 to 60.")}
        onCommit={setCount}
      />
      <label className={styles.check}>
        <input type="checkbox" checked={isLog} onChange={(e) => setLog((l) => ({ ...l, [param.id]: e.target.checked }))} data-testid="sweep-log" />
        Log spacing
      </label>
      <label className={styles.check} title="Start each value from the trap found at the one before, and mark where it vanished">
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} data-testid="sweep-follow" />
        Follow one trap
      </label>
      <SelectField id="sweep-output" label="Plot" value={outputId} options={OUTPUTS.map((o) => ({ value: o.id, label: o.label }))} onChange={setOutputId} />
      {running ? (
        <button type="button" className={ui.button} onClick={cancel} data-testid="sweep-cancel">
          Cancel
        </button>
      ) : (
        <button type="button" className={`${ui.button} ${styles.primary}`} onClick={() => void start()} data-testid="sweep-run">
          Run
        </button>
      )}
      {run && (
        <span className={styles.progress} data-testid="sweep-progress" role="status">
          {running ? `${run.results.length} of ${run.xs.length}` : run.results.length < run.xs.length ? `Stopped at ${run.results.length} of ${run.xs.length}` : `${run.xs.length} solves`}
          {jumpsAt(run.xs, run.results).length > 0 && ` · the trap jumped ${jumpsAt(run.xs, run.results).length}× (the followed trap vanished; marked)`}
          <progress max={run.xs.length} value={run.results.length} />
        </span>
      )}
    </div>
  );

  let plot: ReactNode = (
    <Note title="Sweep">
      Choose an input and a range, and Run: the engine computes the trap at each value, following one trap from value to value; where it vanishes, a line marks the jump. The unstable values are shaded. Each value takes about a second.
    </Note>
  );
  if (run && run.results.length) {
    const swept = params.find((p) => p.id === run.param) ?? param;
    const done = run.xs.slice(0, run.results.length);
    const names = new Map<string, [number, number][]>();
    run.results.forEach((r, i) => {
      if (!r) return;
      for (const { name, value } of output.read(r, swept.set(setup, done[i]))) {
        if (!names.has(name)) names.set(name, []);
        if (value != null) names.get(name)!.push([done[i], value]);
      }
    });
    const stable = run.results.map((r) => Boolean(r?.stable));
    const unit = swept.quantity === "number" ? "" : swept.quantity === "charge" ? "e" : swept.quantity === "temperature" ? "K" : siUnit(swept.quantity);
    const xAxis =
      swept.quantity === "pressure"
        ? { label: swept.label, unit: "Pa", log: isLogRun(run), display: { unit: "mbar", factor: 100 } }
        : { label: swept.label, unit, log: isLogRun(run) };
    plot = (
      <Plot
        id="sweep"
        title={`${output.label} against ${swept.label}`}
        x={xAxis}
        y={output.unit ? { label: output.label, unit: output.unit } : { label: output.label, unit: "", display: { unit: output.id === "depth" ? "k_BT" : "", factor: 1 } }}
        series={[...names].map(([name, points]) => ({ id: name, label: names.size > 1 ? `along ${name}` : output.label, tone: tone(name), points }))}
        bands={unstableRuns(done, stable).map(([a, b]) => ({ from: a, to: b, label: "no stable trap" }))}
        markers={jumpsAt(done, run.results).map((x) => ({ x, label: "jump" }))}
      />
    );
  }
  return (
    <div className={styles.sweep} data-testid="sweep">
      {controls}
      {run?.error && (
        <p className={styles.error} role="alert">
          Some values could not be computed: {run.error}
        </p>
      )}
      <div className={styles.tab}>{plot}</div>
    </div>
  );
}

const isLogRun = (run: SweepRun) => run.key.endsWith("|true");

function siUnit(q: string): string {
  return { length: "m", power: "W", frequency: "Hz", voltage: "V", pressure: "Pa" }[q] ?? "";
}
