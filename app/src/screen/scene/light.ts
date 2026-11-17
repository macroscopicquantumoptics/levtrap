/** Colour of the drawn light: the wavelength's own colour when visible, the theme's laser red in the infrared, violet in the ultraviolet. */
export function lightColor(wavelength: number): string {
  const nm = wavelength * 1e9;
  if (nm > 700) return "var(--light)";
  if (nm < 400) return "#8b5cf6";
  const stops: [number, string][] = [
    [400, "#7c3aed"],
    [450, "#2563eb"],
    [490, "#06b6d4"],
    [530, "#22c55e"],
    [570, "#eab308"],
    [600, "#f97316"],
    [640, "#ef4444"],
    [700, "#dc2626"],
  ];
  return stops.reduce((best, s) => (Math.abs(s[0] - nm) < Math.abs(best[0] - nm) ? s : best))[1];
}
