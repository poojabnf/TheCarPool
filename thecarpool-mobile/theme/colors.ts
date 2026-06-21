/**
 * Legacy palette — now mapped to the light "TheCarPool Redesign" tokens so the
 * few screens still consuming it (the driver offer form) render light and on
 * brand. New screens should import from `theme/tokens.ts` directly.
 */
export const colors = {
  background: '#FAFBFC',   // bgApp
  card: '#FFFFFF',         // surfaceCard
  cardBorder: '#E2E6EA',   // borderSubtle
  primary: '#B8893A',      // brass accent
  success: '#0E8A5F',      // green / confirm
  text: '#141A20',         // ink
  textMuted: '#6B7682',    // text tertiary
  inputBackground: '#F4F6F8', // surface sunken
  inputPlaceholder: '#97A1AB',
};
