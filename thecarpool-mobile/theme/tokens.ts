/**
 * TheCarPool -- design tokens, "Route Line".
 *
 * Every journey is drawn the same way: a line in route green from a ring
 * (pickup) to a square (destination). Green is the one brand colour and the
 * colour of every primary action. Amber is reserved for live, time-sensitive
 * moments -- "leaves in 25 min", "4 min away", requests waiting -- so it keeps
 * its pull. Red is for SOS and leaving, nothing else.
 *
 * Neutrals carry a faint green cast so the ground, cards and ink read as one
 * family with the route colour rather than a grey UI with a green button.
 *
 * Names are kept from the previous system so screens restyle in place:
 * `brass`/`accent` (formerly the metal accent) now resolve to route green.
 */

// ── Neutral scale (green-tinted) ───────────────────────────────────────────
export const gray = {
  0: '#FFFFFF',
  25: '#F6F8F7',
  50: '#EEF2F0', // the app ground
  100: '#E4EAE7',
  150: '#D9E0DD',
  200: '#CBD4D0',
  300: '#AEBAB5',
  400: '#8A9893',
  500: '#64736E',
  600: '#56645F',
  700: '#3A4D47',
  800: '#1F302B',
  900: '#0F1D1A', // ink
  950: '#08120F',
} as const;

// ── Route green -- the brand and every primary action ──────────────────────
export const route = {
  50: '#E3F1EB',
  100: '#C5E3D5',
  300: '#6FBF9C',
  500: '#0A6B4F',
  600: '#06523C',
  700: '#043D2D',
} as const;

// Kept under its old name so existing references restyle rather than break.
export const brass = route;

// ── Semantics ─────────────────────────────────────────────────────────────
export const up = route;
export const down = { 50: '#FDECEA', 500: '#B42318', 600: '#8A1C12', 700: '#6E160E' } as const;
// Amber fills carry ink text; amber AS text uses 700 -- 500 on white fails
// contrast.
export const amber = { 50: '#FFF3DC', 500: '#F5A524', 600: '#A66C12', 700: '#7A4A00' } as const;
export const blue = { 50: '#E6E9F7', 500: '#1E4FD8', 600: '#24307A' } as const;

// ── Semantic aliases (light) ────────────────────────────────────────────────
export const c = {
  bgApp: gray[50],
  bgBase: gray[0],
  surfaceCard: gray[0],
  surfaceSunken: gray[25],
  surfaceInset: gray[100],
  surfaceHover: gray[25],
  // Dark panels: the next-trip card, boarding code, ride in progress.
  surfaceInk: gray[900],
  surfaceInkRaised: gray[800],

  borderSubtle: gray[100],
  borderDefault: gray[150],
  borderStrong: gray[300],

  textPrimary: gray[900],
  textSecondary: gray[600],
  textTertiary: gray[500],
  textDisabled: gray[400],
  textInverse: gray[0],
  textInverseMuted: '#B9C6C1',
  textAccent: route[600],

  actionPrimary: route[500],
  actionPrimaryText: gray[0],
  actionSecondary: gray[0],
  actionSecondaryText: gray[900],

  accent: route[500],
  accentSoft: route[50],

  // The route line itself.
  route: route[500],
  routeEnd: gray[900],

  go: route[500], // confirm / book / available
  goStrong: route[600],
  goSoft: route[50],
  danger: down[500], // SOS / cancel
  dangerStrong: down[600],
  dangerSoft: down[50],
  // Live and time-sensitive. A fill, with ink text on it.
  signal: amber[500],
  signalSoft: amber[50],
  signalText: amber[700],
  warn: amber[700],
  warnSoft: amber[50],
  info: blue[500],
  infoSoft: blue[50],
} as const;

// ── Typography ──────────────────────────────────────────────────────────────
// Loaded in app/_layout.tsx. Figtree to read; Bricolage Grotesque for the
// heading that sets a screen's voice (one per screen, not every title); IBM
// Plex Mono for figures people read aloud or match by eye -- boarding codes,
// fares, number plates, times.
export const font = {
  sans: 'Figtree_400Regular',
  sansMedium: 'Figtree_500Medium',
  sansSemibold: 'Figtree_600SemiBold',
  sansBold: 'Figtree_700Bold',
  sansExtrabold: 'Figtree_800ExtraBold',
  display: 'BricolageGrotesque_800ExtraBold',
  displayBold: 'BricolageGrotesque_700Bold',
  mono: 'IBMPlexMono_500Medium',
  monoBold: 'IBMPlexMono_600SemiBold',
} as const;

// ── Radii / spacing ───────────────────────────────────────────────────────
// Softer than before: cards 20, sheets 24, buttons 16.
export const radius = { sm: 10, md: 14, lg: 20, xl: 24, pill: 9999 } as const;
export const space = { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 } as const;

export const shadowSm = {
  shadowColor: '#0F1D1A',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;

export const shadowLg = {
  shadowColor: '#0F1D1A',
  shadowOpacity: 0.1,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 10 },
  elevation: 8,
} as const;

/**
 * Ride lifecycle colours.
 *
 * Yellow not-yet-started, orange ongoing, green completed. These were written
 * as raw hex in three separate screens — home, the driver dashboard and trips
 * — so "what colour is Ongoing" had three answers that only happened to
 * agree. One definition, so a change lands everywhere at once.
 */
export const rideStatus = {
  pending:   { fg: '#B45309', bg: '#FEF3C7', border: '#FDE68A' },
  ongoing:   { fg: '#C2410C', bg: '#FFEDD5', border: '#FED7AA' },
  completed: { fg: '#15803D', bg: '#DCFCE7', border: '#BBF7D0' },
  cancelled: { fg: '#6B7280', bg: '#F3F4F6', border: '#E5E7EB' },
} as const;

export type RideStatusKey = keyof typeof rideStatus;

/** Pick the palette for a ride/booking state. One rule, used by every screen. */
export function rideStatusColors(opts: {
  completed?: boolean; ongoing?: boolean; cancelled?: boolean;
}): { fg: string; bg: string; border: string } {
  if (opts.cancelled) return rideStatus.cancelled;
  if (opts.completed) return rideStatus.completed;
  if (opts.ongoing) return rideStatus.ongoing;
  return rideStatus.pending;
}

/**
 * Button scale.
 *
 * Buttons had drifted: primary actions were 50pt on Home, 46pt on the ride
 * card, 54pt on Confirm & Pay and a padding-derived height on the driver
 * dashboard -- and "primary" meant ink on one screen, green on the next and
 * the legacy theme's blue on a third. Three answers to "what does the main
 * button look like", none of them wrong on its own.
 *
 * One scale, in the ride-hailing idiom the app is borrowing from: a tall flat
 * slab, no gradient, no shadow, a modest corner, and weight carried by the
 * fill rather than ornament. Text is semibold at a size that stays legible one
 * -handed at arm's length.
 */
export const button = {
  /**
   * Heights, corners and label sizes follow Uber's Base design system, whose
   * button tokens are public in uber/baseweb: buttonBorderRadius 8, and
   * heights of scale950/1200/1400 -- 36, 48 and 56.
   *
   * The corner is the tell. At 8 a button reads as a slab of the interface;
   * by 12 it has started to become a lozenge floating on top of it, and the
   * screen loses its grid. Everything else here is ordinary; that one value
   * is most of the look.
   */
  height: { sm: 36, md: 48, lg: 56 },
  radius: 8,
  paddingX: { sm: 12, md: 16, lg: 20 },
  fontSize: { sm: 14, md: 16, lg: 18 },
  /** Icon/label gap, and the icon size that sits level with the text. */
  gap: 8,
  iconSize: { sm: 16, md: 18, lg: 20 },
  /**
   * Pressed feedback is a darkening overlay, not opacity.
   *
   * Fading a near-black button against a white page turns it grey -- it reads
   * as becoming disabled at the exact moment it is being used. Base darkens
   * the fill instead, so the button stays itself and only deepens.
   */
  pressDarken: 0.14,
  /** Transparent variants have no fill to darken, so they tint instead. */
  pressTint: gray[100],
} as const;

/**
 * Mix a hex colour toward black. Used for pressed button fills.
 *
 * Kept here rather than in the component so the pressed state is derived from
 * the same token as the resting one and cannot drift from it.
 */
export function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((ch) => ch + ch).join('') : h;
  const n = parseInt(full, 16);
  if (!Number.isFinite(n)) return hex;
  const k = Math.max(0, Math.min(1, 1 - amount));
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/**
 * Icon drawing.
 *
 * Stroke weight was being chosen per call site -- 1.9, 2.4 and 2.6 all appear
 * across the screens, none of them wrong, none of them agreeing. Lucide draws
 * at 2 by default, so anything else is a decision, and a decision made twelve
 * times separately is not a decision.
 *
 * Two weights: normal for an icon sitting beside text, emphasis for one
 * carrying meaning on its own -- a selected tab, a status mark, a warning.
 */
export const icon = {
  stroke: { normal: 2, emphasis: 2.5 },
  /** Sizes that sit level with the type they accompany. */
  size: { sm: 14, md: 16, lg: 18, xl: 22 },
} as const;
