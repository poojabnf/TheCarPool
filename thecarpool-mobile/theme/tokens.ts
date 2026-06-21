/**
 * TheCarPool Redesign — design tokens.
 *
 * Ported from the "TheCarPool Redesign" system: a light, premium
 * "data-terminal" palette with a cool-gray neutral scale, a single restrained
 * brass accent (premium / verified), green = go/confirm, red = SOS/cancel, and
 * monospace (JetBrains Mono) for all figures. Sans is Manrope.
 *
 * Screens migrate to these tokens incrementally; the legacy `theme/colors.ts`
 * (dark) stays until each screen is redesigned.
 */

// ── Neutral scale (cool, faint blue cast) ──────────────────────────────────
export const gray = {
  0: '#FFFFFF',
  25: '#FAFBFC',
  50: '#F4F6F8',
  100: '#ECEFF2',
  150: '#E2E6EA',
  200: '#D6DBE1',
  300: '#BCC4CC',
  400: '#97A1AB',
  500: '#6B7682',
  600: '#4D5862',
  700: '#364049',
  800: '#212931',
  900: '#141A20',
  950: '#0B0F14',
} as const;

// ── Brass — the single metal accent, used sparingly (premium / verified) ────
export const brass = {
  50: '#F7F0E0',
  100: '#EEE0C2',
  300: '#D8B673',
  500: '#B8893A',
  600: '#9A7130',
  700: '#7C5A26',
} as const;

// ── Semantics: green = up/go/confirm/book, red = down/SOS/cancel ────────────
export const up = { 50: '#E6F4EE', 500: '#0E8A5F', 600: '#0B6E4C', 700: '#085639' } as const;
export const down = { 50: '#FBEAE8', 500: '#D1453B', 600: '#B0352C', 700: '#8C2A23' } as const;
export const amber = { 50: '#FBF1DD', 500: '#C9851A', 600: '#A66C12' } as const;
export const blue = { 50: '#E8F0FB', 500: '#2563B8', 600: '#1D4F95' } as const;

// ── Semantic aliases (light) ────────────────────────────────────────────────
export const c = {
  bgApp: gray[25],
  bgBase: gray[0],
  surfaceCard: gray[0],
  surfaceSunken: gray[50],
  surfaceInset: gray[100],
  surfaceHover: gray[50],

  borderSubtle: gray[150],
  borderDefault: gray[200],
  borderStrong: gray[300],

  textPrimary: gray[900],
  textSecondary: gray[600],
  textTertiary: gray[500],
  textDisabled: gray[400],
  textInverse: gray[0],
  textAccent: brass[600],

  // Primary action = ink; secondary = white surface.
  actionPrimary: gray[900],
  actionPrimaryText: gray[0],
  actionSecondary: gray[0],
  actionSecondaryText: gray[900],

  accent: brass[500],
  accentSoft: brass[50],

  go: up[500], // confirm / book / available
  goStrong: up[600],
  goSoft: up[50],
  danger: down[500], // SOS / cancel
  dangerStrong: down[600],
  dangerSoft: down[50],
  warn: amber[500],
  warnSoft: amber[50],
  info: blue[500],
  infoSoft: blue[50],
} as const;

// ── Typography ──────────────────────────────────────────────────────────────
// Loaded via expo-font (see app/_layout.tsx). `mono` is used for ALL figures
// (fares, distances, counts, times) per the design.
export const font = {
  sans: 'Manrope_400Regular',
  sansMedium: 'Manrope_500Medium',
  sansSemibold: 'Manrope_600SemiBold',
  sansBold: 'Manrope_700Bold',
  sansExtrabold: 'Manrope_800ExtraBold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

// ── Radii / spacing ───────────────────────────────────────────────────────
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 9999 } as const;
export const space = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 } as const;

export const shadowSm = {
  shadowColor: '#0B0F14',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

export const shadowLg = {
  shadowColor: '#0B0F14',
  shadowOpacity: 0.1,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
} as const;
