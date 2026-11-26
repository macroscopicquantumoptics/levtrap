/**
 * The formula sheet: every formula a number on the screen is explained by,
 * as data. Each is TeX (typeset by KaTeX in the popover) and plain text (for
 * the clipboard and screen readers). formulas.test.ts typesets every entry,
 * so a typo fails the build, not the page.
 *
 * The formulas are the engine's own (src/levtrap): the source named is the
 * one its docstring cites.
 */

export interface Formula {
  tex: string;
  /** the same in plain text */
  text: string;
  /** where it comes from, when it is not textbook */
  source?: string;
}

const tex = String.raw;

export const FORMULAS = {
  "optical-frequency": {
    tex: tex`f_i = \frac{1}{2\pi}\sqrt{\frac{k_i}{m}}`,
    text: "f = √(k / m) / 2π",
  },
  "paul-pseudopotential": {
    tex: tex`f_i = \frac{f_\mathrm{RF}}{2}\sqrt{a_i + \frac{q_i^2}{2}}`,
    text: "f = (f_RF / 2) · √(a + q² / 2)",
    source: "Leibfried et al., Rev. Mod. Phys. 75, 281 (2003), Sec. II.A",
  },
  "paul-exact": {
    tex: tex`f_i = \beta_i\,\frac{f_\mathrm{RF}}{2}, \qquad \cos(\pi\beta_i) = \tfrac{1}{2}\operatorname{tr} M(a_i, q_i)`,
    text: "f = β · f_RF / 2, with cos(πβ) = tr M(a, q) / 2",
    source: "Leibfried et al., Rev. Mod. Phys. 75, 281 (2003); M is the Mathieu equation's monodromy over one RF period",
  },
  depth: {
    tex: tex`U = \min_i \left( -\int_{\mathbf{r}_0}^{\mathbf{r}_{\mathrm{b},i}} \mathbf{F}\cdot d\mathbf{s} \right)`,
    text: "U = −∫ F · ds from the equilibrium to the nearest barrier, the smallest over the axes",
  },
  equilibrium: {
    tex: tex`\mathbf{F}(\mathbf{r}_0) = \sum_j \mathbf{F}_j(\mathbf{r}_0) = 0`,
    text: "F(r₀) = Σ F_j(r₀) = 0",
  },
  stiffness: {
    tex: tex`K_{ij} = -\left.\frac{\partial F_i}{\partial x_j}\right|_{\mathbf{r}_0}, \qquad k_n = \operatorname{eig}\,\tfrac{1}{2}\left(K + K^{\mathsf{T}}\right)`,
    text: "k = eigenvalues of −∂F/∂r at the equilibrium (symmetrised)",
  },
  mass: {
    tex: tex`m = \tfrac{4}{3}\pi R^3 \rho`,
    text: "m = 4/3 π R³ ρ",
  },
  "scattered-power": {
    tex: tex`P_\mathrm{sca} = \oint \mathbf{S}_\mathrm{sca} \cdot d\mathbf{A}`,
    text: "P_sca = ∮ S_sca · dA (the scattered field's Poynting flux)",
  },
  "multipole-power": {
    tex: tex`P_\mathrm{sca} = \sum_{n} \left( P^{\mathrm{E}}_{n} + P^{\mathrm{M}}_{n} \right), \qquad P^{\mathrm{E}}_{n} = 4 \sum_{m} |q_{nm}|^2, \quad P^{\mathrm{M}}_{n} = 4 \sum_{m} |p_{nm}|^2`,
    text: "P_sca = Σ (P_E,n + P_M,n): each multipole's outgoing wave carries its own power, with no cross terms",
    source: "the scattered beam's coefficients, q on the electric (N) waves and p on the magnetic (M) waves, in OTT's convention (levtrap.derived.multipole_power)",
  },
  "absorbed-power": {
    tex: tex`P_\mathrm{abs} = -\oint \mathbf{S} \cdot d\mathbf{A}`,
    text: "P_abs = −∮ S · dA (the total field's net inflow)",
  },
  "mathieu-a": {
    tex: tex`a_i = \frac{4 Q c_i}{m \Omega^2}, \qquad \Omega = 2\pi f_\mathrm{RF}`,
    text: "a = 4 Q c / (m Ω²), c the static curvature of the potential",
    source: "Leibfried et al., Rev. Mod. Phys. 75, 281 (2003), Sec. II.A",
  },
  "mathieu-q": {
    tex: tex`q_i = -\frac{2 Q c'_i}{m \Omega^2}, \qquad \Omega = 2\pi f_\mathrm{RF}`,
    text: "q = −2 Q c′ / (m Ω²), c′ the RF curvature of the potential",
    source: "Leibfried et al., Rev. Mod. Phys. 75, 281 (2003), Sec. II.A",
  },
  micromotion: {
    tex: tex`A_i = \tfrac{1}{2}\left| q_i\, x_{0,i} \right|`,
    text: "A = |q x₀| / 2",
    source: "Leibfried et al., Rev. Mod. Phys. 75, 281 (2003), Sec. II.A",
  },
  "gas-damping": {
    tex: tex`\begin{aligned} \gamma &= \frac{6\pi\eta R}{m}\,\frac{0.619}{0.619 + \mathrm{Kn}}\,(1 + c_K) \\ c_K &= \frac{0.31\,\mathrm{Kn}}{0.785 + 1.152\,\mathrm{Kn} + \mathrm{Kn}^2}, \qquad \mathrm{Kn} = \frac{\ell}{R} \end{aligned}`,
    text: "γ = (6πηR / m) · 0.619 / (0.619 + Kn) · (1 + c_K), Kn = ℓ / R",
    source: "Beresnev, Chernyak & Fomyagin, J. Fluid Mech. 219, 405 (1990)",
  },
  reheating: {
    tex: tex`\Gamma_i = \frac{\gamma\, k_\mathrm{B} T}{\hbar \Omega_i} + \Gamma_{\mathrm{recoil},i}`,
    text: "Γ = γ k_B T / (ħ Ω) + Γ_recoil",
  },
  recoil: {
    tex: tex`\frac{\Gamma_{\mathrm{recoil},i}}{\Omega_i} = \frac{1}{2 m \omega \Omega_i^2} \oint \Big| \frac{\partial \mathbf{F}}{\partial u_i} \Big|^2 d\Omega, \qquad \frac{\partial \mathbf{F}}{\partial u_i} = \mathbf{G}_i - i k\, (\hat{u}_i \cdot \hat{n})\, \mathbf{F}`,
    text: "Γ/Ω = ∮ |∂F/∂u|² dΩ / (2 m ω Ω²), ∂F/∂u = G_u − i k (u·n) F: the position information in the scattered far field F. |k (u·n) F|² gives the scattered photons, |G_u|² the beam photons (what the sphere scatters from the field's gradient), the rest their cross term. A plane wave gives ω P_sca n² / (2 m c² Ω²) · (⟨(u·n)²⟩ + (u·e_in)² − 2 (u·e_in)(u·⟨n⟩))",
    source: "Tebbenjohanns, Frimmer & Novotny, PRA 100, 043821 (2019) (backaction = information); plane-wave limit: Jain et al., PRL 116, 243601 (2016), Seberson & Robicheaux, PRA 102, 033505 (2020) (levtrap.rates)",
  },
  crossover: {
    tex: tex`\frac{\gamma(p)\, k_\mathrm{B} T}{\hbar \Omega_i} = \Gamma_{\mathrm{recoil},i}`,
    text: "the pressure p where gas heating γ(p) k_B T / (ħ Ω) equals recoil heating",
  },
  "lens-focus-shift": {
    tex: tex`\Delta\mathbf{r} = \mathbf{P}^{*}_{\text{as set}} - \mathbf{P}^{*}_{\text{aligned}}, \qquad \mathbf{P}^{*} = \arg\min_{\mathbf{P}}\, \operatorname{Var}_{I}\, W(\mathbf{u}; \mathbf{P})`,
    text: "Δr = P*(as set) − P*(aligned), P* the point that minimises the intensity-weighted variance of the wavefront error W",
    source: "ray trace of the Thorlabs Zemax prescription (levtrap.lens)",
  },
  "lens-clipping": {
    tex: tex`L = 1 - \frac{\sum_{\text{rays through}} I}{\sum_{\text{all rays}} I}`,
    text: "L = 1 − (power of the rays that pass both surfaces) / (power of the beam)",
    source: "ray trace of the Thorlabs Zemax prescription (levtrap.lens)",
  },
  "trap-axis-tilt": {
    tex: tex`\alpha = \arccos \left| \hat{\mathbf{e}}_{\text{axial}} \cdot \hat{\mathbf{d}} \right|`,
    text: "α = arccos |e_axial · d|, between the trap's axial mode and the beam's direction",
  },
  "mirror-reflected": {
    tex: tex`\frac{P_\text{focus}}{P_\text{beam}} = e^{-2\rho_\mathrm{h}^2 / w^2} - e^{-2R^2 / w^2}`,
    text: "P(focus) / P(beam) = exp(−2 ρh² / w²) − exp(−2 R² / w²): the Gaussian beam's power between the hole and the rim",
    source: "geometric optics on the paraboloid (levtrap.mirror; Lieb & Meixner, Opt. Express 8, 458 (2001))",
  },
  "mirror-rim-angle": {
    tex: tex`\alpha_\mathrm{rim} = 2 \arctan \frac{R}{2f}, \qquad \rho = 2f \tan\frac{\alpha}{2}`,
    text: "α_rim = 2 arctan(R / 2f), from ρ = 2f tan(α/2) on the paraboloid; above 90° when R > 2f",
    source: "the paraboloid z = ρ² / 4f − f about its focus (levtrap.mirror)",
  },
} satisfies Record<string, Formula>;

export type FormulaId = keyof typeof FORMULAS;
