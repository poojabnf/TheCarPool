/**
 * Lightweight in-app localization (roadmap Phase 1: language toggle).
 * ─────────────────────────────────────────────────────
 * A zustand store + dictionary lookup — no native module, so it ships via
 * OTA to existing builds. English is the fallback for any missing key, so
 * screens can adopt `t()` incrementally without breaking.
 *
 * The chosen language lives on the user's Firestore profile via the backend
 * (survives reinstalls); locally it's session state.
 */
import { create } from 'zustand';

export type Lang = 'en' | 'hi';

const en = {
  // Home / search
  good_morning: 'Good morning',
  good_afternoon: 'Good afternoon',
  good_evening: 'Good evening',
  from_pickup: 'From — pickup point',
  to_destination: 'To — destination',
  women_only: 'Women only',
  find_rides: 'Find shared rides',
  no_matches: 'No matches found',
  no_matches_hint: 'Try a wider area, fewer filters, or check back shortly.',
  drivers_on_route: (n: number) => `${n} driver${n > 1 ? 's' : ''} on your route`,
  book_ride: 'Book this ride',
  per_seat: 'per seat',
  verified: 'Verified',
  frequent_routes: 'Frequent routes',
  offline_results: 'You appear to be offline — showing your last results.',
  // Account
  language: 'Language',
  // Trip / chat
  trip_chat: 'Trip chat',
  message_cotravellers: 'Message co-travellers',
  sos: 'SOS',
  share_live_trip: 'Share live trip',
};

const hi: typeof en = {
  good_morning: 'सुप्रभात',
  good_afternoon: 'नमस्ते',
  good_evening: 'शुभ संध्या',
  from_pickup: 'कहाँ से — पिकअप पॉइंट',
  to_destination: 'कहाँ तक — गंतव्य',
  women_only: 'केवल महिलाएँ',
  find_rides: 'साझा राइड खोजें',
  no_matches: 'कोई राइड नहीं मिली',
  no_matches_hint: 'बड़ा क्षेत्र आज़माएँ, फ़िल्टर कम करें, या थोड़ी देर बाद देखें।',
  drivers_on_route: (n: number) => `आपके मार्ग पर ${n} ड्राइवर`,
  book_ride: 'यह राइड बुक करें',
  per_seat: 'प्रति सीट',
  verified: 'सत्यापित',
  frequent_routes: 'नियमित मार्ग',
  offline_results: 'आप ऑफ़लाइन हैं — पिछले परिणाम दिखाए जा रहे हैं।',
  language: 'भाषा',
  trip_chat: 'यात्रा चैट',
  message_cotravellers: 'सह-यात्रियों को संदेश भेजें',
  sos: 'SOS',
  share_live_trip: 'लाइव यात्रा साझा करें',
};

const dictionaries: Record<Lang, typeof en> = { en, hi };

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  lang: 'en',
  setLang: (lang) => set({ lang }),
}));

/** Hook: `const { t, lang, setLang } = useI18n();` — re-renders on language change. */
export function useI18n() {
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const dict = dictionaries[lang] || en;
  return {
    lang,
    setLang,
    t: <K extends keyof typeof en>(key: K): typeof en[K] => (dict[key] ?? en[key]),
  };
}
