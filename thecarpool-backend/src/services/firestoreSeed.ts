import { db } from '../lib/firestore';

const mockUsers = [
  {
    id: 'user_1',
    name: 'Pooja Yadav',
    email: 'pooja.bnf@gmail.com',
    phone: '+919876543210',
    gender: 'FEMALE',
    company_domain: 'google.com',
    society_name: 'DLF Phase 5',
    kyc_status: 'VERIFIED',
    linkedin_profile_url: 'https://linkedin.com/in/poojayadav',
    linkedin_connections: 412,
    created_at: new Date().toISOString()
  },
  {
    id: 'user_2',
    name: 'Amit Sharma',
    email: 'amit.sharma@tcs.com',
    phone: '+919876543211',
    gender: 'MALE',
    company_domain: 'tcs.com',
    society_name: 'Sector 45, Gurugram',
    kyc_status: 'VERIFIED',
    linkedin_profile_url: 'https://linkedin.com/in/amitsharma',
    linkedin_connections: 285,
    created_at: new Date().toISOString()
  },
  {
    id: 'user_3',
    name: 'Sanjay Kumar',
    email: 'sanjay@thecarpool.in',
    phone: '+919876543212',
    gender: 'MALE',
    company_domain: 'thecarpool.in',
    society_name: 'Noida Sector 62',
    kyc_status: 'VERIFIED',
    linkedin_profile_url: 'https://linkedin.com/in/sanjaykumar',
    linkedin_connections: 520,
    created_at: new Date().toISOString()
  }
];

const mockDrivers = [
  {
    id: 'driver_2',
    user_id: 'user_2',
    vehicle_rc: 'HR-26-CC-4242',
    vehicle_make: 'Tata Nexon EV',
    dl_number: 'DL-1420230004242',
    is_ev: true,
    is_verified: true,
    upi_payout_id: 'amitsharma@okhdfcbank',
    created_at: new Date().toISOString()
  },
  {
    id: 'driver_3',
    user_id: 'user_3',
    vehicle_rc: 'UP-16-DK-9999',
    vehicle_make: 'Honda City',
    dl_number: 'UP-1620240009999',
    is_ev: false,
    is_verified: true,
    upi_payout_id: 'sanjaykumar@okaxis',
    created_at: new Date().toISOString()
  }
];

const mockRides = [
  {
    id: 'ride_2',
    driver_id: 'driver_2',
    driver_name: 'Amit Sharma',
    driver_photo: null,
    vehicle_make: 'Tata Nexon EV',
    is_ev: true,
    route_coords: [
      { lat: 28.4418, lng: 77.0624 },
      { lat: 28.4592, lng: 77.0727 },
      { lat: 28.4744, lng: 77.0821 },
      { lat: 28.4962, lng: 77.0901 }
    ],
    seats_total: 4,
    seats_available: 3,
    price_split: 150.00,
    departure_time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    status: 'SCHEDULED',
    vehicle_type: 'CAR',
    music_allowed: true,
    smoking_allowed: false,
    chattiness: 'MEDIUM',
    ac_available: true,
    created_at: new Date().toISOString()
  },
  {
    id: 'ride_3',
    driver_id: 'driver_3',
    driver_name: 'Sanjay Kumar',
    driver_photo: null,
    vehicle_make: 'Honda City',
    is_ev: false,
    route_coords: [
      { lat: 28.6273, lng: 77.3725 },
      { lat: 28.6200, lng: 77.3000 },
      { lat: 28.6304, lng: 77.2177 }
    ],
    seats_total: 3,
    seats_available: 3,
    price_split: 180.00,
    departure_time: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
    status: 'SCHEDULED',
    vehicle_type: 'CAR',
    music_allowed: true,
    smoking_allowed: false,
    chattiness: 'TALKATIVE',
    ac_available: true,
    created_at: new Date().toISOString()
  }
];

const mockClassifieds = [
  {
    id: 'classified_1',
    user_id: 'user_1',
    user_name: 'Pooja Yadav',
    title: 'Roommate wanted in DLF Phase 5',
    description: 'Looking for a flatmate in a premium 3BHK high-rise apartment in DLF Phase 5, Gurugram. Fully furnished, gym access, EV charging socket available in basement.',
    category: 'FLATMATE',
    price: 18000.00,
    created_at: new Date().toISOString()
  },
  {
    id: 'classified_2',
    user_id: 'user_2',
    user_name: 'Amit Sharma',
    title: 'EV Car Charger Socket sharing',
    description: 'I have a 15A socket in Gurugram Sector 45. Happy to share charging slot in the evenings for EV car owners in the community.',
    category: 'ITEM_SHARE',
    price: 50.00,
    created_at: new Date().toISOString()
  }
];

const mockPostalCodes = [
  { postal_code: '122002', place_name: 'DLF Phase 3, Gurugram', state_name: 'Haryana', state_code: 'HR', country_name: 'India', country_iso: 'IND', location: { lat: 28.4962, lng: 77.0901 } },
  { postal_code: '122003', place_name: 'Sector 45, Gurugram', state_name: 'Haryana', state_code: 'HR', country_name: 'India', country_iso: 'IND', location: { lat: 28.4418, lng: 77.0624 } },
  { postal_code: '122018', place_name: 'Sector 21, Gurugram', state_name: 'Haryana', state_code: 'HR', country_name: 'India', country_iso: 'IND', location: { lat: 28.5029, lng: 77.0722 } },
  { postal_code: '560001', place_name: 'MG Road, Bengaluru', state_name: 'Karnataka', state_code: 'KA', country_name: 'India', country_iso: 'IND', location: { lat: 12.9734, lng: 77.6117 } },
  { postal_code: '560066', place_name: 'Whitefield, Bengaluru', state_name: 'Karnataka', state_code: 'KA', country_name: 'India', country_iso: 'IND', location: { lat: 12.9698, lng: 77.7499 } },
  { postal_code: '560103', place_name: 'Outer Ring Road, Bengaluru', state_name: 'Karnataka', state_code: 'KA', country_name: 'India', country_iso: 'IND', location: { lat: 12.9262, lng: 77.6762 } },
  { postal_code: '110001', place_name: 'Connaught Place, New Delhi', state_name: 'Delhi', state_code: 'DL', country_name: 'India', country_iso: 'IND', location: { lat: 28.6304, lng: 77.2177 } },
  { postal_code: '110021', place_name: 'Chanakyapuri, New Delhi', state_name: 'Delhi', state_code: 'DL', country_name: 'India', country_iso: 'IND', location: { lat: 28.5921, lng: 77.1895 } },
  { postal_code: '400001', place_name: 'Fort, Mumbai', state_name: 'Maharashtra', state_code: 'MH', country_name: 'India', country_iso: 'IND', location: { lat: 18.9347, lng: 72.8358 } },
  { postal_code: '400050', place_name: 'Bandra West, Mumbai', state_name: 'Maharashtra', state_code: 'MH', country_name: 'India', country_iso: 'IND', location: { lat: 19.0544, lng: 72.8402 } },
  { postal_code: '95113', place_name: 'Downtown San Jose, Silicon Valley', state_name: 'California', state_code: 'CA', country_name: 'United States', country_iso: 'USA', location: { lat: 37.3337, lng: -121.8907 } },
  { postal_code: '94102', place_name: 'Union Square, San Francisco', state_name: 'California', state_code: 'CA', country_name: 'United States', country_iso: 'USA', location: { lat: 37.7879, lng: -122.4074 } },
  { postal_code: '10001', place_name: 'Chelsea, Manhattan', state_name: 'New York', state_code: 'NY', country_name: 'United States', country_iso: 'USA', location: { lat: 40.7501, lng: -73.9961 } },
  { postal_code: '11201', place_name: 'Brooklyn Heights', state_name: 'New York', state_code: 'NY', country_name: 'United States', country_iso: 'USA', location: { lat: 40.6972, lng: -73.9903 } },
  { postal_code: 'EC1A', place_name: 'City of London', state_name: 'England', state_code: 'ENG', country_name: 'United Kingdom', country_iso: 'GBR', location: { lat: 51.5204, lng: -0.0982 } },
  { postal_code: 'SW1A', place_name: 'Westminster, London', state_name: 'England', state_code: 'ENG', country_name: 'United Kingdom', country_iso: 'GBR', location: { lat: 51.5010, lng: -0.1246 } },
  { postal_code: '80331', place_name: 'Altstadt, Munich', state_name: 'Bavaria', state_code: 'BY', country_name: 'Germany', country_iso: 'DEU', location: { lat: 48.1374, lng: 11.5755 } },
  { postal_code: '10115', place_name: 'Mitte, Berlin', state_name: 'Berlin', state_code: 'BE', country_name: 'Germany', country_iso: 'DEU', location: { lat: 52.5323, lng: 13.3846 } }
];

export async function seedFirestoreIfEmpty() {
  try {
    const usersSnap = await db.collection('users').limit(1).get();
    if (!usersSnap.empty) {
      console.log('[FIRESTORE SEED] Users collection has data. Skipping auto-seed.');
      return;
    }

    console.log('[FIRESTORE SEED] Database is empty. Seeding Firestore collections...');

    // Seed Users
    for (const u of mockUsers) {
      await db.collection('users').doc(u.id).set(u);
    }
    // Seed Drivers
    for (const d of mockDrivers) {
      await db.collection('drivers').doc(d.id).set(d);
    }
    // Seed Rides
    for (const r of mockRides) {
      await db.collection('rides').doc(r.id).set(r);
    }
    // Seed Classifieds
    for (const c of mockClassifieds) {
      await db.collection('classifieds').doc(c.id).set(c);
    }
    // Seed Postal Codes
    for (const pc of mockPostalCodes) {
      const docId = `pc_${pc.country_iso}_${pc.postal_code}`;
      await db.collection('postal_codes').doc(docId).set(pc);
    }

    console.log('[FIRESTORE SEED] Firestore database successfully seeded!');
  } catch (err) {
    console.error('[FIRESTORE SEED] Auto-seeding check failed:', err);
  }
}
