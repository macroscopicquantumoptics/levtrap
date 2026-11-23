"use client";

import { Fragment, useState, type ReactNode } from "react";
import type { Engine } from "../engine/client.ts";
import { alignedSetup, compare, misaligned } from "./aligned.ts";
import { useAnswer } from "./hooks.ts";
import type { AsphereFocus, BeamField, MirrorFocus, Field, Gas, GravityField, PaulField, Polarisation, Result, Setup, Vec3 } from "../engine/types.ts";
import { asphereHalfAngle, LENSES } from "../engine/lenses.ts";
import { mirrorAngles, mirrorHalfAngle, mirrorReflected } from "../engine/mirrors.ts";
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
  /** the engine, for a comparison the inspector asks for (a real lens against the aligned one) */
  engine?: (() => Engine) | null;
  recorded?: boolean;
}

/** The selected thing's inputs: at most six, the rest under one Advanced fold. */
export function Inspector({ setup, part, result, notice, onEdit, onClose, engine = null, recorded = true }: InspectorProps) {
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
      {part.kind === "lens" && field?.kind === "beam" && <LensEditor key={part.id} setup={setup} beam={field} index={part.index!} prefix={prefix} onEdit={onEdit} result={result} engine={engine} recorded={recorded} />}
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

/** The aligned asphere a lens becomes: a 5 mm beam fills it (an NA of about 0.63), enough to hold the default sphere. */
export const NEW_ASPHERE: AsphereFocus = { kind: "asphere", lens: "354330-C", beam_diameter: 5e-3, tilt_deg: [0, 0], decentre: [0, 0] };

/**
 * The parabolic mirror a lens becomes: f 3 mm, 18 mm across, its rim above the
 * focus (light from up to 113°), filled by a 10 mm beam; no hole.
 */
export const NEW_MIRROR: MirrorFocus = { kind: "parabolic_mirror", focal_length: 3e-3, rim_radius: 9e-3, hole_radius: 0, beam_diameter: 1e-2 };

/** The focus a beam gets when its optic changes kind; back to an ideal lens keeps about the same cone. */
function switchFocus(kind: string, theta: number): BeamField["focus"] | null {
  if (kind === "asphere") return { ...NEW_ASPHERE };
  if (kind === "parabolic_mirror") return { ...NEW_MIRROR };
  if (kind === "lens") return { kind: "lens", NA: Number(Math.sin(theta).toPrecision(3)) };
  return null;
}

type EngineProps = { engine: (() => Engine) | null; recorded: boolean };

function LensEditor({ setup, beam, index, prefix, onEdit, result, engine, recorded }: EditorProps & EngineProps & { beam: BeamField; index: number; result: Result | null }) {
  if (beam.focus.kind === "parabolic_mirror") return <MirrorEditor setup={setup} beam={beam} focus={beam.focus} index={index} prefix={prefix} onEdit={onEdit} result={result} />;
  if (beam.focus.kind === "asphere")
    return <AsphereEditor setup={setup} beam={beam} focus={beam.focus} index={index} prefix={prefix} onEdit={onEdit} result={result} engine={engine} recorded={recorded} />;
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
  // an objective with its back aperture filled (#61): NA is then the aperture, and the filling sets the focus
  const filling = focus.NA != null ? (focus.filling ?? null) : null;
  return (
    <>
      <Fields>
        <SelectField
          id={`${prefix}-kind`}
          label="Type"
          value="lens"
          options={lensKinds(setup, beam)}
          onChange={(kind) => {
            const next = kind !== "lens" && switchFocus(kind, angle);
            if (next) edit(next);
          }}
        />
        <NumberField
          id={`${prefix}-NA`}
          label="NA"
          value={na}
          quantity="number"
          check={(v) => (v > 0 && v < n ? null : `Must be between 0 and the medium index (${formatNumber(n, 4, true)}).`)}
          onCommit={(v) => edit(filling != null ? { kind: "lens", NA: v, filling } : { kind: "lens", NA: v })}
        />
        {filling != null ? (
          <NumberField
            id={`${prefix}-filling`}
            label="Filling"
            value={filling}
            quantity="number"
            check={(v) => (v > 0 && v <= 10 ? null : "Must be between 0 and 10.")}
            onCommit={(v) => edit({ kind: "lens", NA: na, filling: v })}
            note="The beam's 1/e² radius on the back aperture, over the aperture's radius: below 1 underfilled, above 1 overfilled."
          />
        ) : (
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
        )}
      </Fields>
      <Advanced
        changed={[
          ...(given === "half-angle" ? [`half-angle ${formatNumber((angle * 180) / Math.PI, 3, true)}°`] : []),
          ...(filling != null ? [`objective, filling ${formatNumber(filling, 3, true)}`] : []),
        ]}
      >
        <SelectField
          id={`${prefix}-model`}
          label="Focus model"
          value={filling != null ? "objective" : "gaussian"}
          options={[
            { value: "gaussian", label: "Gaussian of this NA" },
            { value: "objective", label: "Objective, aperture filled" },
          ]}
          onChange={(m) => edit(m === "objective" ? { kind: "lens", NA: na, filling: 1 } : { kind: "lens", NA: na })}
          note={
            filling != null
              ? "An aplanatic objective of this NA, its back aperture filled by the beam; the power is what passes the aperture."
              : "The Gaussian beam whose far field reaches 1/e² at this NA, with no aperture: the tightest focus of this NA."
          }
        />
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

/** The focusing optics; the asphere and the mirror are computed in a gas or vacuum, for a Gaussian beam. */
function lensKinds(setup: Setup, beam: BeamField) {
  const gaussian = (beam.mode?.type ?? "lg") === "lg" && (beam.mode?.indices ?? [0, 0]).every((i) => i === 0);
  const air = environmentOf(setup).medium_index === 1;
  const why = !air ? " (in a gas or vacuum)" : !gaussian ? " (for a Gaussian beam)" : "";
  return [
    { value: "lens", label: "Ideal lens" },
    { value: "asphere", label: `Asphere ${LENSES["354330-C"].name.replace("Thorlabs ", "")}${why}`, disabled: Boolean(why) },
    { value: "parabolic_mirror", label: `Parabolic mirror${why}`, disabled: Boolean(why) },
  ];
}

/** A real lens, ray traced: the beam on it, its tilt and decentre; and what it does to the focus. */
function AsphereEditor({ setup, beam, focus, index, prefix, onEdit, result, engine, recorded }: EditorProps & EngineProps & { beam: BeamField; focus: AsphereFocus; index: number; result: Result | null }) {
  // compare with the aligned lens (#51): the same setup solved with no tilt and no decentre, on its own channel
  const [comparing, setComparing] = useState(false);
  const off = misaligned(setup, index);
  // the aligned lens solved from the particle's equilibrium as set, so both describe the same trap (continuation)
  const aligned = useAnswer(alignedSetup(setup, index), engine, recorded, [], comparing && off, "aligned", result?.stable ? result.equilibrium : null);
  const comparison = comparing && off && result && aligned.answer.result ? compare(result, aligned.answer.result) : null;
  const followed = aligned.answer.result?.followed;
  const edit = (patch: Partial<AsphereFocus>) => onEdit(withField<BeamField>(setup, index, { focus: { ...focus, ...patch } }));
  const lens = LENSES[focus.lens ?? "354330-C"];
  const [tx, ty] = focus.tilt_deg ?? [0, 0];
  const [dx, dy] = focus.decentre ?? [0, 0];
  const tilt = (v: number) => (Math.abs(v) <= 20 ? null : "At most 20° either way.");
  const decentre = (v: number) => (Math.abs(v) <= 2.5e-3 ? null : "At most 2.5 mm either way.");
  const theta = asphereHalfAngle(lens, focus.beam_diameter);
  const done = result?.lenses?.find((l) => l.field === index);
  return (
    <>
      <Fields>
        <SelectField
          id={`${prefix}-kind`}
          label="Type"
          value="asphere"
          options={lensKinds(setup, beam)}
          onChange={(kind) => {
            const next = kind !== "asphere" && switchFocus(kind, theta);
            if (next) onEdit(withField<BeamField>(setup, index, { focus: next }));
          }}
          note={`Ray traced: f ${formatSI(lens.efl, "m", 3, true)}, NA ${lens.NA}. The beam's position is where the aligned lens focuses.`}
        />
        <NumberField
          id={`${prefix}-beam_diameter`}
          label="Beam diameter"
          value={focus.beam_diameter}
          quantity="length"
          unit="mm"
          check={(v) => (v > 0 && v <= 0.02 ? null : "Between 0 and 20 mm (1/e² intensity, on the lens).")}
          onCommit={(v) => edit({ beam_diameter: v })}
        />
        <NumberField id={`${prefix}-tilt_x`} label="Tilt about x" value={tx} quantity="angle" unit="°" check={tilt} onCommit={(v) => edit({ tilt_deg: [v, ty] })} />
        <NumberField id={`${prefix}-tilt_y`} label="Tilt about y" value={ty} quantity="angle" unit="°" check={tilt} onCommit={(v) => edit({ tilt_deg: [tx, v] })} />
      </Fields>
      <Advanced changed={dx || dy ? [`decentred ${formatSI(Math.hypot(dx, dy), "m", 3, true)}`] : []}>
        <NumberField id={`${prefix}-decentre_x`} label="Decentre x" value={dx} quantity="length" unit="µm" check={decentre} onCommit={(v) => edit({ decentre: [v, dy] })} />
        <NumberField id={`${prefix}-decentre_y`} label="Decentre y" value={dy} quantity="length" unit="µm" check={decentre} onCommit={(v) => edit({ decentre: [dx, v] })} />
      </Advanced>
      {done && (
        <dl className={styles.readout} data-testid={`${prefix}-readout`}>
          <dt>Focus moved</dt>
          <dd>{formatSI(Math.hypot(...done.focus_shift), "m")}</dd>
          <dt>Clipped by the lens</dt>
          <dd>{formatNumber(100 * done.clipping_loss, 3)} %</dd>
          <dt>Trap axis tilted</dt>
          <dd>{done.trap_axis_tilt_mrad == null ? "—" : `${formatNumber(done.trap_axis_tilt_mrad, 3)} mrad`}</dd>
          <dt>Wavefront error</dt>
          <dd>{formatNumber(done.rms_waves, 3)} waves rms</dd>
        </dl>
      )}
      <button
        type="button"
        className={ui.button}
        aria-pressed={comparing}
        disabled={!off || !engine}
        title={off ? "Solve the same setup with the lens aligned, and show what the tilt and decentre do" : "The lens is aligned: nothing to compare"}
        onClick={() => setComparing((c) => !c)}
        data-testid={`${prefix}-compare`}
      >
        {comparing ? "Hide the comparison" : "Compare with the aligned lens"}
      </button>
      {comparing && off && (
        <dl className={styles.readout} data-testid={`${prefix}-comparison`} data-pending={aligned.pending || undefined}>
          {comparison ? (
            <>
              <dt>Particle moved</dt>
              <dd>{formatSI(Math.hypot(...comparison.shift), "m")}</dd>
              {followed?.jumped && (
                <>
                  <dt>Note</dt>
                  <dd>the trap vanishes as the lens aligns: another trap is compared</dd>
                </>
              )}
              <dt>by x, y, z</dt>
              <dd>{comparison.shift.map((v) => formatSI(v, "m", 2)).join(", ")}</dd>
              {comparison.modes.map((m) => (
                <Fragment key={m.name}>
                  <dt>f{m.name} against aligned</dt>
                  <dd>
                    {m.change == null ? "—" : `${m.change >= 0 ? "+" : "−"}${formatNumber(Math.abs(100 * m.change), 3)} %`}
                    {m.aligned != null && ` (${formatSI(m.aligned, "Hz", 3)})`}
                  </dd>
                </Fragment>
              ))}
            </>
          ) : (
            <>
              <dt>Aligned lens</dt>
              <dd>
                {!result?.stable ? "the lens as set holds no stable trap" : aligned.pending || !aligned.answer.result ? "solving…" : "the aligned lens holds no stable trap"}
              </dd>
            </>
          )}
        </dl>
      )}
      <p className={styles.aside}>Drawn at its true size and distance, with its tilt and decentre.</p>
    </>
  );
}

/** A parabolic mirror: its focal length, rim and hole, the beam on it; and how much of the beam it reflects. */
function MirrorEditor({ setup, beam, focus, index, prefix, onEdit, result }: EditorProps & { beam: BeamField; focus: MirrorFocus; index: number; result: Result | null }) {
  const edit = (patch: Partial<MirrorFocus>) => onEdit(withField<BeamField>(setup, index, { focus: { ...focus, ...patch } }));
  const [aHole, aRim] = mirrorAngles(focus);
  const deg = (a: number) => `${formatNumber((a * 180) / Math.PI, 4, true)}°`;
  const hole = focus.hole_radius ?? 0;
  const done = result?.mirrors?.find((m) => m.field === index);
  const upTo100mm = (v: number) => (v > 0 && v <= 0.1 ? null : "Between 0 and 100 mm.");
  return (
    <>
      <Fields>
        <SelectField
          id={`${prefix}-kind`}
          label="Type"
          value="parabolic_mirror"
          options={lensKinds(setup, beam)}
          onChange={(kind) => {
            const next = kind !== "parabolic_mirror" && switchFocus(kind, mirrorHalfAngle(focus));
            if (next) onEdit(withField<BeamField>(setup, index, { focus: next }));
          }}
          note="The collimated beam comes down around the focus and the mirror sends it back up to it. The beam's position is the focus."
        />
        <NumberField id={`${prefix}-focal_length`} label="Focal length" value={focus.focal_length} quantity="length" unit="mm" check={upTo100mm} onCommit={(v) => edit({ focal_length: v })} />
        <NumberField
          id={`${prefix}-rim_radius`}
          label="Rim radius"
          value={focus.rim_radius}
          quantity="length"
          unit="mm"
          check={(v) => upTo100mm(v) ?? (v > hole ? null : "Must be larger than the hole.")}
          onCommit={(v) => edit({ rim_radius: v })}
          note={`Light from up to ${deg(aRim)} off the axis${aRim > Math.PI / 2 ? ": the rim is above the focus (a deep mirror)" : ""}.`}
        />
        <NumberField
          id={`${prefix}-beam_diameter`}
          label="Beam diameter"
          value={focus.beam_diameter}
          quantity="length"
          unit="mm"
          check={(v) => (v > 0 && v <= 0.1 ? null : "Between 0 and 100 mm (1/e² intensity).")}
          onCommit={(v) => edit({ beam_diameter: v })}
        />
      </Fields>
      <Advanced changed={hole ? [`hole ${formatSI(hole, "m", 3, true)}`] : []}>
        <NumberField
          id={`${prefix}-hole_radius`}
          label="Hole radius"
          value={hole}
          quantity="length"
          unit="mm"
          check={(v) => (v >= 0 && v < focus.rim_radius ? null : "From 0 up to the rim radius.")}
          onCommit={(v) => edit({ hole_radius: v })}
          note={hole ? `No light from within ${deg(aHole)} of the axis.` : "A central hole, for the light to leave or the particle to be loaded."}
        />
      </Advanced>
      <dl className={styles.readout} data-testid={`${prefix}-readout`}>
        <dt>Reflected to the focus</dt>
        <dd>{formatNumber(100 * (done?.reflected ?? mirrorReflected(focus)), 3)} %</dd>
        <dt>Light from</dt>
        <dd>
          {hole ? `${deg(aHole)} to ` : "the axis to "}
          {deg(aRim)}
        </dd>
      </dl>
      <p className={styles.aside}>Drawn at its true size, around the focus. Geometric optics on the mirror: no diffraction at its rim or hole.</p>
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
