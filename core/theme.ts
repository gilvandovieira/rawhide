// Rawhide Identity — leather/gold theme tokens for the SSR screens.
import type { Mode } from "./types.ts";

export interface Tokens {
  bg: string;
  g1: string;
  g2: string;
  surface: string;
  inset: string;
  chip: string;
  border: string;
  border2: string;
  ink: string;
  muted: string;
  faint: string;
  faint2: string;
  gold: string;
  goldText: string;
  onGold: string;
  happy: string;
  edge: string;
  error: string;
  errBg: string;
  errBorder: string;
  errChipB: string;
  errChipT: string;
  errChip: string;
  errTint: string;
  glow: string;
}

export const THEMES: Record<Mode, Tokens> = {
  dark: {
    bg: "#140E08",
    g1: "#2A1D10",
    g2: "#100B06",
    surface: "#241A12",
    inset: "#1C140D",
    chip: "#1A130C",
    border: "#34281B",
    border2: "#3A2C1D",
    ink: "#F0E7D4",
    muted: "#B6A88E",
    faint: "#7E7059",
    faint2: "#6E6049",
    gold: "#E3B45C",
    goldText: "#E8C679",
    onGold: "#1A1208",
    happy: "#A6CE6A",
    edge: "#ECB44E",
    error: "#E87A5A",
    errBg: "#241712",
    errBorder: "#3A241D",
    errChipB: "#4A2E26",
    errChipT: "#D9A48E",
    errChip: "#1E120E",
    errTint: "#241510",
    glow: "rgba(227,180,92,.28)",
  },
  light: {
    bg: "#EEE2CD",
    g1: "#F7F0E1",
    g2: "#E6D6BC",
    surface: "#FBF5EA",
    inset: "#F1E7D4",
    chip: "#F4ECDD",
    border: "#E2D4BA",
    border2: "#D8C8AC",
    ink: "#2C2114",
    muted: "#6E5E45",
    faint: "#9A876A",
    faint2: "#7E6B4C",
    gold: "#9C6B1A",
    goldText: "#8A5A14",
    onGold: "#FFF7EA",
    happy: "#4E7B3E",
    edge: "#C2841C",
    error: "#B23A28",
    errBg: "#FBEEEA",
    errBorder: "#E6CFC8",
    errChipB: "#E0C4BC",
    errChipT: "#A6532F",
    errChip: "#FBF4F1",
    errTint: "#FBEAE4",
    glow: "rgba(156,107,26,.20)",
  },
};

/** Serialize tokens to a CSS custom-property declaration string for a root element. */
export function cssVars(t: Tokens): string {
  return Object.entries(t).map(([k, v]) => `--${k}:${v}`).join(";");
}
