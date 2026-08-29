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
  // Tabs
  tab_home: 'Home',
  tab_rides: 'Rides',
  tab_trips: 'Trips',
  tab_wallet: 'Wallet',
  tab_account: 'You',

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
  your_activity: 'Your activity',
  offline_results: 'You appear to be offline — showing your last results.',
  seats_left: (n: number) => `${n} seat${n === 1 ? '' : 's'} left`,
  avoided_co2: "You've avoided",
  co2_quarter: 'CO₂ this quarter',
  detour: 'detour',
  when_any: 'Anytime',
  when_today: 'Today',
  when_morning: 'Morning',
  when_evening: 'Evening',

  // Rides Tab
  rides_title: 'Rides',
  rides_sub: 'Find a shared ride, or offer your seats.',
  find_a_ride: 'Find a ride',
  find_a_ride_sub: 'Search verified drivers on your route',
  offer_a_ride: 'Offer a ride',
  offer_a_ride_sub: 'Share your commute and split the fare',

  // Trips Tab
  my_trips: 'My Trips',
  upcoming_trips: 'Upcoming',
  past_trips: 'Past',
  no_trips: 'No trips yet',
  no_trips_hint: 'Rides you book or offer will appear here.',
  cancel_booking: 'Cancel booking',
  complete_ride: 'Complete ride',
  report_issue: 'Report a problem',
  retry: 'Retry',
  status_not_started: 'Not yet started',
  status_ongoing: 'Ongoing',
  status_completed: 'Completed',
  status_cancelled: 'Cancelled',
  status_awaiting: 'Awaiting driver',

  // Wallet Tab
  wallet_title: 'Wallet',
  wallet_balance: 'Available balance',
  add_money: 'Add money',
  transactions: 'Recent transactions',
  no_transactions: 'No transactions yet',

  // Account / You Tab
  account_title: 'You',
  edit_profile: 'Edit profile',
  add_name: 'Add your name',
  wallet_and_payments: 'Wallet & payments',
  wallet_and_payments_sub: 'Balance, UPI, cards',
  payout_details: 'Payout details',
  booking_history: 'Booking history',
  booking_history_sub: 'Your past rides & payments',
  rides_offered: 'Rides you offered',
  rides_offered_sub: "Trips you're driving",
  green_leaderboard: 'Green leaderboard',
  green_leaderboard_sub: 'Top CO₂ savers in the community',
  safety_centre: 'Safety Centre',
  safety_centre_sub: 'SOS, trip sharing, emergency contacts',
  settings: 'Settings',
  settings_sub: 'Notifications, privacy, account',
  help_support: 'Help & support',
  help_support_sub: 'FAQs, contact us',
  log_out: 'Log out',
  language: 'Language',
  delete_account: 'Delete my account',
  privacy_policy: 'Privacy policy',
  contact_support: 'Contact support',
  app_version: 'App version',
  save: 'Save',
  first_name: 'First name',
  last_name: 'Last name',
  address_optional: 'Address (optional)',

  // Trip / chat
  trip_chat: 'Trip chat',
  message_cotravellers: 'Message co-travellers',
  sos: 'SOS',
  share_live_trip: 'Share live trip',
  driver: 'Driver',
  rider: 'Rider',
  otp_label: 'Boarding OTP',
  enter_otp: 'Enter OTP',
  verify_otp: 'Verify OTP',
  trip_in_progress: 'Trip in progress',
  hide_sheet: 'Hide sheet',
  expand_sheet: 'Expand details',
};

const hi: typeof en = {
  // Tabs
  tab_home: 'होम',
  tab_rides: 'राइड्स',
  tab_trips: 'यात्राएँ',
  tab_wallet: 'वॉलेट',
  tab_account: 'प्रोफ़ाइल',

  // Home / search
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
  your_activity: 'आपकी गतिविधियाँ',
  offline_results: 'आप ऑफ़लाइन हैं — पिछले परिणाम दिखाए जा रहे हैं।',
  seats_left: (n: number) => `${n} सीट शेष`,
  avoided_co2: 'आपने बचाया',
  co2_quarter: 'CO₂ इस तिमाही',
  detour: 'अतिरिक्त दूरी',
  when_any: 'कभी भी',
  when_today: 'आज',
  when_morning: 'सुबह',
  when_evening: 'शाम',

  // Rides Tab
  rides_title: 'राइड्स',
  rides_sub: 'साझा राइड खोजें या अपनी सीट ऑफ़र करें।',
  find_a_ride: 'राइड खोजें',
  find_a_ride_sub: 'अपने मार्ग पर सत्यापित ड्राइवर खोजें',
  offer_a_ride: 'राइड ऑफ़र करें',
  offer_a_ride_sub: 'सवारी साझा करें और किराया बाँटें',

  // Trips Tab
  my_trips: 'मेरी यात्राएँ',
  upcoming_trips: 'आगामी',
  past_trips: 'पिछली',
  no_trips: 'कोई यात्रा नहीं',
  no_trips_hint: 'आपके द्वारा बुक या ऑफ़र की गई राइड्स यहाँ दिखेंगी।',
  cancel_booking: 'बुकिंग रद्द करें',
  complete_ride: 'यात्रा पूर्ण करें',
  report_issue: 'समस्या की रिपोर्ट करें',
  retry: 'पुनः प्रयास करें',
  status_not_started: 'अभी शुरू नहीं',
  status_ongoing: 'प्रगति पर',
  status_completed: 'पूर्ण हुई',
  status_cancelled: 'रद्द',
  status_awaiting: 'ड्राइवर स्वीकृति की प्रतीक्षा',

  // Wallet Tab
  wallet_title: 'वॉलेट',
  wallet_balance: 'उपलब्ध राशि',
  add_money: 'पैसे जोड़ें',
  transactions: 'हाल के लेन-देन',
  no_transactions: 'कोई लेन-देन नहीं',

  // Account / You Tab
  account_title: 'प्रोफ़ाइल',
  edit_profile: 'प्रोफ़ाइल संपादित करें',
  add_name: 'अपना नाम जोड़ें',
  wallet_and_payments: 'वॉलेट और भुगतान',
  wallet_and_payments_sub: 'शेष राशि, UPI, कार्ड',
  payout_details: 'निकासी विवरण',
  booking_history: 'बुकिंग इतिहास',
  booking_history_sub: 'आपकी पिछली राइड्स और भुगतान',
  rides_offered: 'ऑफ़र की गई राइड्स',
  rides_offered_sub: 'आपके द्वारा चलाई जाने वाली ट्रिप्स',
  green_leaderboard: 'पर्यावरण लीडरबोर्ड',
  green_leaderboard_sub: 'समुदाय में शीर्ष CO₂ बचतकर्ता',
  safety_centre: 'सुरक्षा केंद्र',
  safety_centre_sub: 'SOS, यात्रा शेयरिंग, आपातकालीन संपर्क',
  settings: 'सेटिंग्स',
  settings_sub: 'सूचनाएँ, गोपनीयता, खाता',
  help_support: 'सहायता और समर्थन',
  help_support_sub: 'अक्सर पूछे जाने वाले प्रश्न, संपर्क करें',
  log_out: 'लॉग आउट',
  language: 'भाषा',
  delete_account: 'मेरा खाता हटाएँ',
  privacy_policy: 'गोपनीयता नीति',
  contact_support: 'सहायता से संपर्क करें',
  app_version: 'ऐप वर्शन',
  save: 'सहेजें',
  first_name: 'पहला नाम',
  last_name: 'अंतिम नाम',
  address_optional: 'पता (वैकल्पिक)',

  // Trip / chat
  trip_chat: 'यात्रा चैट',
  message_cotravellers: 'सह-यात्रियों को संदेश भेजें',
  sos: 'SOS',
  share_live_trip: 'लाइव यात्रा साझा करें',
  driver: 'ड्राइवर',
  rider: 'यात्री',
  otp_label: 'बोर्डिंग OTP',
  enter_otp: 'OTP दर्ज करें',
  verify_otp: 'OTP सत्यापित करें',
  trip_in_progress: 'यात्रा जारी है',
  hide_sheet: 'छिपाएँ',
  expand_sheet: 'विवरण देखें',
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
