"use client";

import type { ReactNode } from "react";
import type { BeamField, Field, Gas, GravityField, PaulField, Polarisation, Result, Setup, Vec3 } from "../engine/types.ts";
import { formatNumber, formatSI } from "../lib/format.ts";
import type { Notice } from "./answer.ts";
import {
  directionOf,
  environmentOf,
  gravityOf,
  hasKind,
  modeLabel,
  partsOf,
  positionOf,
  removeField,
  subscript,
  wavelengthText,
  withEnvironment,
  withField,
  withParticle,
  type Part,
  type PartId,
} from "./model.ts";
import { getMaterial, MATERIAL_NAMES } from "../engine/materials.ts";
import { angleFromNA, angleFromWaist, modeOrder, naFromAngle, radiusFromMass, sphereMass, waistFromAngle } from "../lib/linked.ts";
import { NumberField, SelectField } from "./ui/fields.tsx";
import { Icon } from "./ui/Icon.tsx";
import ui from "./ui/ui.module.css";
import styles from "./Inspector.module.css";

const KIND_NOTE: Record<Part["kind"], string> = {
  particle: "A homogeneous sphere",
  beam: "A focused laser beam",
  lens: "The optic that focuses the beam",
  paul: "RF electrodes for a charged particle",
  gravity: "The particle's weight",
  environment: "The gas around the particle",
};

export interface InspectorProps {
  setup: Setup;
  part: Part;
  /** the latest result, for values the engine resolved (n, k, density) */
  result: Result | null;
  /** what is wrong with the setup, when this part is the one to fix */
  notice: Notice | null;
  /** one edit: one undo step */
  onEdit(setup: Setup, select?: PartId | null): void;
  onClose(): void;
}

/** The selected thing's inputs: at most six, the rest under one Advanced fold. */
export function Inspector({ setup, part, result, notice, onEdit, onClose }: InspectorProps) {
  const field = part.index === undefined ? undefined : setup.trap.fields[part.index];
  const removable = part.kind === "beam" || part.kind === "paul" || part.kind === "gravity";
  const prefix = `${part.kind}${part.index ?? ""}`;
  return (
    <aside className={`${ui.island} ${styles.inspector}`} aria-label={`${part.name} settings`} data-testid="inspector" data-part={part.id}>
      <header className={styles.head}>
        <span className={styles.kindIcon} data-kind={part.kind}>
          <Icon name={part.kind} />
        </span>
        <div className={styles.titles}>
          <h2 className={styles.title}>{part.name}</h2>
          <p className={styles.kind}>{KIND_NOTE[part.kind]}</p>
        </div>
        <button type="button" className={ui.iconButton} aria-label="Close settings" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>

      {notice?.kind === "invalid" && notice.part === part.id && (
        <p className={styles.problem} role="alert">
          {notice.text}
        </p>
      )}

      {part.kind === "particle" && <ParticleEditor key={part.id} setup={setup} result={result} prefix={prefix} onEdit={onEdit} />}
      {part.kind === "environment" && <EnvironmentEditor key={part.id} setup={setup} prefix={prefix} onEdit={onEdit} />}
      {part.kind === "beam" && field?.kind === "beam" && <BeamEditor key={part.id} setup={setup} beam={field} index={part.index!} prefix={prefix} onEdit={onEdit} />}
      {part.kind === "lens" && field?.kind === "beam" && <LensEditor key={part.id} setup={setup} beam={field} index={part.index!} prefix={prefix} onEdit={onEdit} />}
      {part.kind === "paul" && field?.kind === "paul" && <PaulEditor key={part.id} setup={setup} paul={field} index={part.index!} prefix={prefix} onEdit={onEdit} />}
      {part.kind === "gravity" && field?.kind === "gravity" && <GravityEditor key={part.id} setup={setup} gravity={field} index={part.index!} prefix={prefix} onEdit={onEdit} />}

      {removable && (
        <footer className={styles.foot}>
          <button type="button" className={`${ui.button} ${ui.danger}`} data-testid="remove-field" onClick={() => onEdit(removeField(setup, part.index!), null)}>
            <Icon name="trash" />
            Remove {part.name.toLowerCase()}
          </button>
        </footer>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------

interface EditorProps {
  setup: Setup;
  prefix: string;
  onEdit(setup: Setup, select?: PartId | null): void;
}

function Fields({ children }: { children: ReactNode }) {
  return <div className={styles.fields}>{children}</div>;
}

/** The one fold for everything that is rarely changed. Its summary names what differs from the default. */
function Advanced({ changed, children }: { changed: string[]; children: ReactNode }) {
  return (
    <details className={styles.advanced} data-testid="advanced">
      <summary className={styles.advancedSummary}>
        <span className={styles.chevron}>
          <Icon name="chevron" />
        </span>
        <span>Advanced</span>
        {changed.length > 0 && <span className={styles.changed}>{changed.join(" · ")}</span>}
      </summary>
      <Fields>{children}</Fields>
    </details>
  );
}

const positive = (v: number) => (v > 0 ? null : "Must be greater than 0.");
const notNegative = (v: number) => (v >= 0 ? null : "Must not be negative.");
const whole = (v: number) => (Number.isInteger(v) ? null : "Must be a whole number.");

// ---- particle -----------------------------------------------------------------

function ParticleEditor({ setup, prefix, onEdit }: EditorProps & { result: Result | null }) {
  const p = setup.particle;
  const beam = setup.trap.fields.find((f): f is BeamField => f.kind === "beam");
  const wavelength = beam?.wavelength ?? 1.064e-6;
  const custom = !p.material;
  const charged = hasKind(setup, "paul") || Boolean(p.charge);
  // the material's values at the beam's wavelength, as the engine will take them
  const mat = p.material ? getMaterial(p.material, wavelength) : null;
  const n = p.n ?? (mat?.valid ? mat.n : 1.45);
  const k = p.k ?? (mat?.valid ? mat.k : 0);
  const density = p.density ?? mat?.density ?? 2200;
  const edit = (patch: Partial<typeof p>) => onEdit(withParticle(setup, patch));
  const charge = (
    <NumberField id={`${prefix}-charge`} label="Charge" value={p.charge ?? 0} quantity="charge" unit="e" check={whole} onCommit={(v) => edit({ charge: v })} />
  );
  const note = !mat ? null : mat.valid ? (
    <>
      n = {formatNumber(mat.n, 4)}, k = {formatNumber(mat.k, 2)}, {formatNumber(mat.density, 4, true)} kg/m³ at {wavelengthText(wavelength)}.{" "}
      <span className={styles.source}>Source: {mat.source}.</span>
    </>
  ) : (
    <>
      No data for {subscript(p.material!)} at {wavelengthText(wavelength)}: choose Custom and type n and k.{" "}
      <span className={styles.source}>Source: {mat.source}.</span>
    </>
  );
  return (
    <>
      <Fields>
        <SelectField
          id={`${prefix}-material`}
          label="Material"
          value={p.material ?? "custom"}
          options={[...MATERIAL_NAMES.map((m) => ({ value: m, label: subscript(m) })), { value: "custom", label: "Custom" }]}
          onChange={(m) => edit(m === "custom" ? { material: null, n, k, density } : { material: m, n: undefined, k: undefined, density: undefined })}
          note={note}
        />
        <NumberField id={`${prefix}-radius`} label="Radius" value={p.radius} quantity="length" unit="nm" check={positive} onCommit={(v) => edit({ radius: v })} />
        {charged && charge}
      </Fields>
      <Advanced changed={[...(custom ? [`n ${formatNumber(n, 3, true)}`] : []), ...(!charged && p.charge ? [`${p.charge} e`] : [])]}>
        {/* linked to the radius: one sphere */}
        <NumberField id={`${prefix}-diameter`} label="Diameter" value={2 * p.radius} quantity="length" unit="nm" check={positive} onCommit={(v) => edit({ radius: v / 2 })} />
        <NumberField
          id={`${prefix}-mass`}
          label="Mass"
          value={sphereMass(p.radius, density) * 1e3}
          quantity="mass"
          unit="fg"
          check={positive}
          onCommit={(v) => edit({ radius: radiusFromMass(v / 1e3, density) })}
        />
        <NumberField id={`${prefix}-n`} label="Refractive index n" value={n} quantity="number" check={positive} disabled={!custom} onCommit={(v) => edit({ n: v })} />
        <NumberField id={`${prefix}-k`} label="Absorption k" value={k} quantity="number" check={notNegative} disabled={!custom} onCommit={(v) => edit({ k: v })} />
        <NumberField id={`${prefix}-density`} label="Density" value={density} quantity="density" unit="kg/m³" check={positive} disabled={!custom} onCommit={(v) => edit({ density: v })} />
        {!charged && charge}
        {!custom && <p className={ui.fieldNote}>n, k and density follow the material. Choose Custom to type them.</p>}
      </Advanced>
    </>
  );
}

// ---- environment ----------------------------------------------------------------

function EnvironmentEditor({ setup, prefix, onEdit }: EditorProps) {
  const env = environmentOf(setup);
  const edit = (patch: Partial<typeof env>) => onEdit(withEnvironment(setup, patch));
  return (
    <>
      <Fields>
        <NumberField id={`${prefix}-pressure`} label="Pressure" value={env.pressure} quantity="pressure" unit="mbar" check={notNegative} onCommit={(v) => edit({ pressure: v })} />
        <SelectField
          id={`${prefix}-gas`}
          label="Gas"
          value={env.gas}
          options={(["N2", "He", "air"] as Gas[]).map((g) => ({ value: g, label: g === "air" ? "Air" : subscript(g) }))}
          onChange={(gas) => edit({ gas })}
        />
        <NumberField id={`${prefix}-temperature`} label="Temperature" value={env.temperature} quantity="temperature" unit="K" check={positive} onCommit={(v) => edit({ temperature: v })} />
      </Fields>
      <Advanced changed={env.medium_index !== 1 ? [`medium index ${formatNumber(env.medium_index, 4, true)}`] : []}>
        <NumberField
          id={`${prefix}-medium_index`}
          label="Medium index"
          value={env.medium_index}
          quantity="number"
          check={(v) => (v >= 1 ? null : "Must be at least 1.")}
          onCommit={(v) => edit({ medium_index: v })}
          note="1 for vacuum or a dilute gas."
        />
      </Advanced>
    </>
  );
}

// ---- beam -------------------------------------------------------------------------

const POLARISATIONS: { value: string; label: string }[] = [
  { value: "x", label: "Linear x" },
  { value: "y", label: "Linear y" },
  { value: "circular+", label: "Circular +" },
  { value: "circular-", label: "Circular −" },
];

const same = (a: Vec3, b: Vec3) => a.every((c, i) => Math.abs(c - b[i]) < 1e-12);
const opposite = (a: Vec3, b: Vec3) => a.every((c, i) => Math.abs(c + b[i]) < 1e-12);
const flip = (v: Vec3): Vec3 => [v[0] ? -v[0] : 0, v[1] ? -v[1] : 0, v[2] ? -v[2] : 0];

function BeamEditor({ setup, beam, index, prefix, onEdit }: EditorProps & { beam: BeamField; index: number }) {
  const edit = (patch: Partial<BeamField>) => onEdit(withField<BeamField>(setup, index, patch));
  const parts = partsOf(setup);
  const beams = setup.trap.fields.map((f, i) => ({ f, i })).filter((b): b is { f: BeamField; i: number } => b.f.kind === "beam");
  const first = beams[0];
  const others = beams.filter((b) => b.i !== index);
  const nameOf = (i: number) => parts.find((p) => p.id === `field:${i}`)?.name ?? "Beam";

  const pol = typeof (beam.polarisation ?? "x") === "string" ? ((beam.polarisation ?? "x") as string) : "custom";
  const direction = directionOf(beam);
  const relation = index === first.i ? "first" : same(direction, directionOf(first.f)) ? "with" : opposite(direction, directionOf(first.f)) ? "against" : "custom";
  // interference is one link between two beams, whichever of them holds it
  const partner = others.find((o) => (beam.coherent_with && o.f.id === beam.coherent_with) || (o.f.coherent_with && o.f.coherent_with === beam.id));
  const setPartner = (value: string) => {
    let next = setup;
    for (const o of others) if (o.f.coherent_with === beam.id) next = withField<BeamField>(next, o.i, { coherent_with: null });
    const target = others.find((o) => String(o.i) === value);
    onEdit(withField<BeamField>(next, index, { coherent_with: target?.f.id ?? null }));
  };

  const mode = beam.mode ?? {};
  const family = modeLabel(beam) === "Gaussian" ? "gaussian" : (mode.type ?? "lg");
  const [i0, i1] = mode.indices ?? [0, 0];
  const position = positionOf(beam);
  const setPosition = (axis: number, v: number) => edit({ position: position.map((c, i) => (i === axis ? v : c)) as Vec3 });
  const changed = [
    ...(family !== "gaussian" ? [modeLabel(beam)] : []),
    ...(position.some((c) => c !== 0) ? [`focus moved ${formatSI(Math.hypot(...position), "m", 2, true)}`] : []),
    ...(relation === "custom" ? ["own direction"] : []),
  ];

  return (
    <>
      <Fields>
        <NumberField id={`${prefix}-power`} label="Power" value={beam.power} quantity="power" unit="mW" check={notNegative} onCommit={(v) => edit({ power: v })} />
        <NumberField id={`${prefix}-wavelength`} label="Wavelength" value={beam.wavelength} quantity="length" unit="nm" check={positive} onCommit={(v) => edit({ wavelength: v })} />
        <SelectField
          id={`${prefix}-polarisation`}
          label="Polarisation"
          value={pol}
          options={pol === "custom" ? [...POLARISATIONS, { value: "custom", label: "Custom (Jones vector)" }] : POLARISATIONS}
          onChange={(v) => v !== "custom" && edit({ polarisation: v as Polarisation })}
        />
        {relation !== "first" && (
          <SelectField
            id={`${prefix}-direction`}
            label="Direction"
            value={relation}
            options={[
              { value: "against", label: `Against ${nameOf(first.i).toLowerCase()}` },
              { value: "with", label: `With ${nameOf(first.i).toLowerCase()}` },
              ...(relation === "custom" ? [{ value: "custom" as const, label: "Custom" }] : []),
            ]}
            onChange={(v) => v !== "custom" && edit({ direction: v === "against" ? flip(directionOf(first.f)) : directionOf(first.f) })}
          />
        )}
        {others.length > 0 && (
          <SelectField
            id={`${prefix}-coherent`}
            label="Interferes with"
            value={partner ? String(partner.i) : "none"}
            options={[{ value: "none", label: "Nothing" }, ...others.map((o) => ({ value: String(o.i), label: nameOf(o.i), disabled: !o.f.id }))]}
            onChange={setPartner}
            note={partner ? null : "Beams that do not interfere add their forces."}
          />
        )}
        {partner && <NumberField id={`${prefix}-phase`} label="Phase" value={beam.phase ?? 0} quantity="phase" unit="π rad" onCommit={(v) => edit({ phase: v })} />}
      </Fields>
      <Advanced changed={changed}>
        <SelectField
          id={`${prefix}-mode`}
          label="Mode"
          value={family}
          options={[
            { value: "gaussian", label: "Gaussian" },
            { value: "lg", label: "Laguerre–Gauss" },
            { value: "hg", label: "Hermite–Gauss" },
          ]}
          onChange={(v) => edit({ mode: v === "gaussian" ? { type: "lg", indices: [0, 0] } : { type: v as "lg" | "hg", indices: v === family ? [i0, i1] : [0, 1] } })}
        />
        {family !== "gaussian" && (
          <>
            <NumberField
              id={`${prefix}-mode0`}
              label={family === "lg" ? "Radial index p" : "Index m (x)"}
              value={i0}
              quantity="number"
              check={(v) => whole(v) ?? notNegative(v)}
              onCommit={(v) => edit({ mode: { type: family as "lg" | "hg", indices: [v, i1] } })}
            />
            <NumberField
              id={`${prefix}-mode1`}
              label={family === "lg" ? "Azimuthal index ℓ" : "Index n (y)"}
              value={i1}
              quantity="number"
              check={(v) => whole(v) ?? (family === "hg" ? notNegative(v) : null)}
              onCommit={(v) => edit({ mode: { type: family as "lg" | "hg", indices: [i0, v] } })}
            />
          </>
        )}
        {(["x", "y", "z"] as const).map((axis, a) => (
          <NumberField key={axis} id={`${prefix}-position-${axis}`} label={`Focus ${axis}`} value={position[a]} quantity="length" unit="µm" onCommit={(v) => setPosition(a, v)} />
        ))}
      </Advanced>
    </>
  );
}

// ---- lens ---------------------------------------------------------------------------

function LensEditor({ setup, beam, index, prefix, onEdit }: EditorProps & { beam: BeamField; index: number }) {
  const focus = beam.focus;
  const n = environmentOf(setup).medium_index;
  const order = modeOrder(beam.mode?.type ?? "lg", beam.mode?.indices ?? [0, 0]);
  const edit = (next: BeamField["focus"]) => onEdit(withField<BeamField>(setup, index, { focus: next }));
  // NA, waist and half-angle are one focus (the engine's relation); the setup keeps the one last typed
  const angle =
    focus.NA != null ? angleFromNA(focus.NA, n) : focus.angle_deg != null ? (focus.angle_deg * Math.PI) / 180 : angleFromWaist(focus.waist!, beam.wavelength, n, order);
  const na = naFromAngle(angle, n);
  const waist = waistFromAngle(angle, beam.wavelength, n, order);
  const given = focus.NA != null ? "NA" : focus.waist != null ? "waist" : "half-angle";
  return (
    <>
      <Fields>
        <SelectField
          id={`${prefix}-kind`}
          label="Type"
          value="lens"
          options={[
            { value: "lens", label: "Ideal lens" },
            { value: "asphere", label: "Asphere 354330-C (later)", disabled: true },
            { value: "parabolic_mirror", label: "Parabolic mirror (later)", disabled: true },
          ]}
          onChange={() => {}}
        />
        <NumberField
          id={`${prefix}-NA`}
          label="NA"
          value={na}
          quantity="number"
          check={(v) => (v > 0 && v < n ? null : `Must be between 0 and the medium index (${formatNumber(n, 4, true)}).`)}
          onCommit={(v) => edit({ kind: "lens", NA: v })}
        />
        <NumberField
          id={`${prefix}-waist`}
          label={<>Waist w₀</>}
          value={waist}
          quantity="length"
          unit="µm"
          check={positive}
          onCommit={(v) => edit({ kind: "lens", waist: v })}
          note={`Linked to the NA${order ? ` for this mode (order ${order})` : ""}. The setup keeps the ${given}.`}
        />
      </Fields>
      <Advanced changed={given === "half-angle" ? [`half-angle ${formatNumber((angle * 180) / Math.PI, 3, true)}°`] : []}>
        <NumberField
          id={`${prefix}-angle`}
          label="Half-angle"
          value={(angle * 180) / Math.PI}
          quantity="angle"
          unit="°"
          check={(v) => (v > 0 && v <= 90 ? null : "Must be between 0° and 90°.")}
          onCommit={(v) => edit({ kind: "lens", angle_deg: v })}
        />
      </Advanced>
      <p className={styles.aside}>Drawn with its true cone angle. Its distance from the focus is not to scale.</p>
    </>
  );
}

// ---- Paul trap ------------------------------------------------------------------------

function PaulEditor({ setup, paul, index, prefix, onEdit }: EditorProps & { paul: PaulField; index: number }) {
  const edit = (patch: Partial<PaulField>) => onEdit(withField<PaulField>(setup, index, patch));
  const factors = { radial: 1, axial: 1, ...paul.geometry_factors };
  const linear = paul.geometry === "linear";
  const changed = [
    ...(paul.dc_voltage ? [`DC ${formatSI(paul.dc_voltage, "V", 3, true)}`] : []),
    ...(factors.radial !== 1 ? [`radial factor ${formatNumber(factors.radial, 3, true)}`] : []),
    ...(linear && factors.axial !== 1 ? [`axial factor ${formatNumber(factors.axial, 3, true)}`] : []),
  ];
  return (
    <>
      <Fields>
        <SelectField
          id={`${prefix}-geometry`}
          label="Geometry"
          value={paul.geometry}
          options={[
            { value: "linear", label: "Linear (four rods)" },
            { value: "ring", label: "Ring" },
          ]}
          onChange={(geometry) => edit({ geometry })}
        />
        <NumberField id={`${prefix}-rf_voltage`} label="RF voltage" value={paul.rf_voltage} quantity="voltage" unit="V" check={notNegative} onCommit={(v) => edit({ rf_voltage: v })} />
        <NumberField id={`${prefix}-rf_frequency`} label="RF frequency" value={paul.rf_frequency} quantity="frequency" unit="kHz" check={positive} onCommit={(v) => edit({ rf_frequency: v })} />
        <NumberField id={`${prefix}-r0`} label={<>Radius r₀</>} value={paul.r0} quantity="length" unit="mm" check={positive} onCommit={(v) => edit({ r0: v })} />
        <NumberField id={`${prefix}-z0`} label={<>Half-length z₀</>} value={paul.z0} quantity="length" unit="mm" check={positive} onCommit={(v) => edit({ z0: v })} />
        {linear && <NumberField id={`${prefix}-endcap_voltage`} label="End-cap voltage" value={paul.endcap_voltage ?? 0} quantity="voltage" unit="V" onCommit={(v) => edit({ endcap_voltage: v })} />}
      </Fields>
      <Advanced changed={changed}>
        <NumberField id={`${prefix}-dc_voltage`} label="DC voltage" value={paul.dc_voltage ?? 0} quantity="voltage" unit="V" onCommit={(v) => edit({ dc_voltage: v })} />
        <NumberField
          id={`${prefix}-factor-radial`}
          label="Geometry factor, radial"
          value={factors.radial}
          quantity="number"
          check={positive}
          onCommit={(v) => edit({ geometry_factors: { ...factors, radial: v } })}
        />
        {linear && (
          <NumberField
            id={`${prefix}-factor-axial`}
            label="Geometry factor, axial"
            value={factors.axial}
            quantity="number"
            check={positive}
            onCommit={(v) => edit({ geometry_factors: { ...factors, axial: v } })}
          />
        )}
      </Advanced>
    </>
  );
}

// ---- gravity --------------------------------------------------------------------------

const DIRECTIONS: { value: string; label: string; unit: Vec3 }[] = [
  { value: "down", label: "Down (−y)", unit: [0, -1, 0] },
  { value: "+z", label: "Along the beam (+z)", unit: [0, 0, 1] },
  { value: "-z", label: "Against the beam (−z)", unit: [0, 0, -1] },
];

function GravityEditor({ setup, gravity, index, prefix, onEdit }: EditorProps & { gravity: GravityField; index: number }) {
  const g = gravityOf(gravity);
  const size = Math.hypot(...g);
  const along = DIRECTIONS.find((d) => size > 0 && d.unit.every((c, i) => Math.abs(c - g[i] / size) < 1e-9));
  const edit = (next: Vec3) => onEdit(withField<Field>(setup, index, { g: next } as Partial<GravityField>));
  const scaled = (unit: Vec3, s: number): Vec3 => [unit[0] * s || 0, unit[1] * s || 0, unit[2] * s || 0];
  return (
    <>
      <Fields>
        <SelectField
          id={`${prefix}-direction`}
          label="Direction"
          value={along?.value ?? "custom"}
          options={[...DIRECTIONS.map(({ value, label }) => ({ value, label })), ...(along ? [] : [{ value: "custom", label: "Custom" }])]}
          onChange={(v) => {
            const d = DIRECTIONS.find((o) => o.value === v);
            if (d) edit(scaled(d.unit, size || 9.81));
          }}
          note="y is up; z is the first beam's axis."
        />
      </Fields>
      <Advanced changed={Math.abs(size - 9.81) > 1e-9 ? [`${formatNumber(size, 3, true)} m/s²`] : []}>
        <NumberField
          id={`${prefix}-g`}
          label="Acceleration"
          value={size}
          quantity="acceleration"
          unit="m/s²"
          check={notNegative}
          onCommit={(v) => edit(scaled(along?.unit ?? (size > 0 ? (g.map((c) => c / size) as Vec3) : [0, -1, 0]), v))}
        />
      </Advanced>
    </>
  );
}
