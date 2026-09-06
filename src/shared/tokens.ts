/**
 * Verisphere design tokens.
 *
 * Branded (not Wikipedia-native): a clear Verisphere layer sitting on top of
 * the page. Indigo is the Verisphere brand accent; support/challenge reuse the
 * green/red the web app already uses, and the Verity Score gradient reuses the
 * red<->white<->green scale from `frontend/src/ui/vsColor.ts`.
 */
export const tokens = {
  brand: "#4f46e5", // indigo — Verisphere accent
  brandInk: "#312e81",
  ink: "#111827",
  muted: "#6b7280",
  faint: "#9ca3af",
  line: "#e5e7eb",
  support: "#16a34a",
  challenge: "#dc2626",
  surface: "#ffffff",
  surfaceAlt: "#f8f9fa",
  shadow: "0 8px 28px rgba(17,24,39,0.18)",
  radius: 12,
  // z-index sits above Wikipedia chrome but the UI lives in a shadow root anyway.
  z: 2147483000,
  font:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
} as const;

export type Tokens = typeof tokens;
