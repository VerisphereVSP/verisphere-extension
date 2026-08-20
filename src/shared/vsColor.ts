/**
 * Verity Score → color. Ported from `frontend/src/ui/vsColor.ts` so the overlay
 * speaks the same visual language as the web app.
 *
 * `evs` is the effective Verity Score expressed on a [-100, +100] scale
 * (−100 = fully challenged, 0 = contested/neutral, +100 = fully supported).
 */
/**
 * The score color: green when supported, red when challenged, gray when
 * contested or unscored. Shared by in-page underlines, the superscript score
 * badge and the score chips so one claim reads as one color everywhere.
 */
export function evsToColor(evs?: number): string {
  if (evs === undefined || Number.isNaN(evs)) return "#9ca3af";
  const v = Math.max(-100, Math.min(100, evs)) / 100;
  if (v > 0.05) return "#16a34a";
  if (v < -0.05) return "#dc2626";
  return "#9ca3af";
}

/** Short human label for a score, e.g. "+73 supported" / "contested". */
export function evsLabel(evs?: number, active = true): string {
  if (!active) return "unsettled";
  if (evs === undefined || Number.isNaN(evs)) return "no score";
  if (evs > 5) return `+${Math.round(evs)} supported`;
  if (evs < -5) return `${Math.round(evs)} challenged`;
  return "contested";
}
