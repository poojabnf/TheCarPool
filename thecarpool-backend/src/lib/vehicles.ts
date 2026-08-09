/**
 * Vehicle catalogue and size classification. Pure — no I/O — so the class a
 * rider sees is unit-testable.
 *
 * WHY A CLASS AT ALL
 * Riders care about how much room they're getting far more than the badge on
 * the bonnet. "Maruti Swift" means nothing to someone deciding whether three
 * people and a suitcase will fit; HATCHBACK does. The class drives the icon on
 * the match card so the choice is visible at a glance.
 *
 * The classification is derived SERVER-SIDE from make+model. A client could
 * otherwise claim SUV for a two-seater and mislead riders at the point of
 * booking.
 *
 * Coverage is the common Indian market, not the world. Anything unlisted falls
 * back to OTHER, and a driver can always type a free-text make/model — an
 * unknown car must never block someone from offering a ride.
 */

export type VehicleClass =
  | 'HATCHBACK'
  | 'SEDAN'
  | 'SUV'
  | 'MPV'
  | 'LUXURY'
  | 'BIKE'
  | 'OTHER';

export interface VehicleClassInfo {
  label: string;
  /** Plain-language hint shown under the icon. */
  description: string;
  /** Typical passenger seats excluding the driver — a sizing hint, not a rule. */
  typicalSeats: number;
}

export const VEHICLE_CLASSES: Record<VehicleClass, VehicleClassInfo> = {
  HATCHBACK: { label: 'Hatchback', description: 'Compact · good for 2–3', typicalSeats: 3 },
  SEDAN:     { label: 'Sedan',     description: 'Comfortable · boot space', typicalSeats: 3 },
  SUV:       { label: 'SUV',       description: 'Roomy · high seating', typicalSeats: 4 },
  MPV:       { label: 'MPV / Van', description: 'Most room · 6+ seats', typicalSeats: 6 },
  LUXURY:    { label: 'Luxury',    description: 'Premium comfort', typicalSeats: 3 },
  BIKE:      { label: 'Bike',      description: 'Two-wheeler · 1 pillion', typicalSeats: 1 },
  OTHER:     { label: 'Vehicle',   description: 'Other vehicle', typicalSeats: 3 },
};

/**
 * Make → models, each with its class. Kept as data rather than heuristics so a
 * wrong classification is a one-line fix, not a regex puzzle.
 */
export const VEHICLE_CATALOGUE: Record<string, { model: string; class: VehicleClass }[]> = {
  Maruti_Suzuki: [
    { model: 'Alto', class: 'HATCHBACK' }, { model: 'S-Presso', class: 'HATCHBACK' },
    { model: 'Celerio', class: 'HATCHBACK' }, { model: 'Wagon R', class: 'HATCHBACK' },
    { model: 'Swift', class: 'HATCHBACK' }, { model: 'Baleno', class: 'HATCHBACK' },
    { model: 'Ignis', class: 'HATCHBACK' }, { model: 'Dzire', class: 'SEDAN' },
    { model: 'Ciaz', class: 'SEDAN' }, { model: 'Brezza', class: 'SUV' },
    { model: 'Fronx', class: 'SUV' }, { model: 'Grand Vitara', class: 'SUV' },
    { model: 'Jimny', class: 'SUV' }, { model: 'Ertiga', class: 'MPV' },
    { model: 'XL6', class: 'MPV' }, { model: 'Eeco', class: 'MPV' },
    { model: 'Invicto', class: 'MPV' },
  ],
  Hyundai: [
    { model: 'Grand i10 Nios', class: 'HATCHBACK' }, { model: 'i20', class: 'HATCHBACK' },
    { model: 'Exter', class: 'SUV' }, { model: 'Venue', class: 'SUV' },
    { model: 'Creta', class: 'SUV' }, { model: 'Alcazar', class: 'SUV' },
    { model: 'Tucson', class: 'SUV' }, { model: 'Aura', class: 'SEDAN' },
    { model: 'Verna', class: 'SEDAN' }, { model: 'Ioniq 5', class: 'SUV' },
  ],
  Tata: [
    { model: 'Tiago', class: 'HATCHBACK' }, { model: 'Altroz', class: 'HATCHBACK' },
    { model: 'Punch', class: 'SUV' }, { model: 'Nexon', class: 'SUV' },
    { model: 'Curvv', class: 'SUV' }, { model: 'Harrier', class: 'SUV' },
    { model: 'Safari', class: 'SUV' }, { model: 'Tigor', class: 'SEDAN' },
    { model: 'Tiago EV', class: 'HATCHBACK' }, { model: 'Nexon EV', class: 'SUV' },
  ],
  Mahindra: [
    { model: 'XUV 3XO', class: 'SUV' }, { model: 'Bolero', class: 'SUV' },
    { model: 'Bolero Neo', class: 'SUV' }, { model: 'Thar', class: 'SUV' },
    { model: 'Thar Roxx', class: 'SUV' }, { model: 'Scorpio Classic', class: 'SUV' },
    { model: 'Scorpio N', class: 'SUV' }, { model: 'XUV700', class: 'SUV' },
    { model: 'XEV 9e', class: 'SUV' }, { model: 'BE 6', class: 'SUV' },
    { model: 'Marazzo', class: 'MPV' },
  ],
  Toyota: [
    { model: 'Glanza', class: 'HATCHBACK' }, { model: 'Taisor', class: 'SUV' },
    { model: 'Urban Cruiser Hyryder', class: 'SUV' }, { model: 'Fortuner', class: 'SUV' },
    { model: 'Innova Crysta', class: 'MPV' }, { model: 'Innova Hycross', class: 'MPV' },
    { model: 'Rumion', class: 'MPV' }, { model: 'Camry', class: 'LUXURY' },
    { model: 'Vellfire', class: 'LUXURY' },
  ],
  Honda: [
    { model: 'Amaze', class: 'SEDAN' }, { model: 'City', class: 'SEDAN' },
    { model: 'Elevate', class: 'SUV' }, { model: 'Jazz', class: 'HATCHBACK' },
    { model: 'WR-V', class: 'SUV' },
  ],
  Kia: [
    { model: 'Sonet', class: 'SUV' }, { model: 'Syros', class: 'SUV' },
    { model: 'Seltos', class: 'SUV' }, { model: 'Carens', class: 'MPV' },
    { model: 'Carnival', class: 'MPV' }, { model: 'EV6', class: 'SUV' },
  ],
  Renault: [
    { model: 'Kwid', class: 'HATCHBACK' }, { model: 'Triber', class: 'MPV' },
    { model: 'Kiger', class: 'SUV' },
  ],
  Nissan: [{ model: 'Magnite', class: 'SUV' }],
  Volkswagen: [
    { model: 'Virtus', class: 'SEDAN' }, { model: 'Taigun', class: 'SUV' },
    { model: 'Tiguan', class: 'SUV' },
  ],
  Skoda: [
    { model: 'Slavia', class: 'SEDAN' }, { model: 'Kushaq', class: 'SUV' },
    { model: 'Kylaq', class: 'SUV' }, { model: 'Superb', class: 'LUXURY' },
  ],
  MG: [
    { model: 'Comet EV', class: 'HATCHBACK' }, { model: 'Astor', class: 'SUV' },
    { model: 'Hector', class: 'SUV' }, { model: 'ZS EV', class: 'SUV' },
    { model: 'Gloster', class: 'SUV' }, { model: 'Windsor EV', class: 'MPV' },
  ],
  Citroen: [
    { model: 'C3', class: 'HATCHBACK' }, { model: 'Basalt', class: 'SUV' },
    { model: 'C3 Aircross', class: 'SUV' },
  ],
  Jeep: [{ model: 'Compass', class: 'SUV' }, { model: 'Meridian', class: 'SUV' }],
  BMW: [{ model: '3 Series', class: 'LUXURY' }, { model: '5 Series', class: 'LUXURY' }, { model: 'X1', class: 'LUXURY' }],
  Mercedes_Benz: [{ model: 'A-Class', class: 'LUXURY' }, { model: 'C-Class', class: 'LUXURY' }, { model: 'GLC', class: 'LUXURY' }],
  Audi: [{ model: 'A4', class: 'LUXURY' }, { model: 'Q3', class: 'LUXURY' }, { model: 'Q5', class: 'LUXURY' }],
  Hero: [{ model: 'Splendor', class: 'BIKE' }, { model: 'HF Deluxe', class: 'BIKE' }, { model: 'Xtreme', class: 'BIKE' }],
  Honda_Two_Wheeler: [{ model: 'Activa', class: 'BIKE' }, { model: 'Shine', class: 'BIKE' }, { model: 'SP 125', class: 'BIKE' }],
  TVS: [{ model: 'Jupiter', class: 'BIKE' }, { model: 'Apache', class: 'BIKE' }, { model: 'Raider', class: 'BIKE' }],
  Bajaj: [{ model: 'Pulsar', class: 'BIKE' }, { model: 'Chetak', class: 'BIKE' }, { model: 'Platina', class: 'BIKE' }],
  Royal_Enfield: [{ model: 'Classic 350', class: 'BIKE' }, { model: 'Hunter 350', class: 'BIKE' }, { model: 'Meteor 350', class: 'BIKE' }],
  Ola_Electric: [{ model: 'S1 Pro', class: 'BIKE' }, { model: 'S1 Air', class: 'BIKE' }],
  Ather: [{ model: '450X', class: 'BIKE' }, { model: 'Rizta', class: 'BIKE' }],
  Other: [],
};

/** Display name for a catalogue key ("Maruti_Suzuki" -> "Maruti Suzuki"). */
export const makeLabel = (key: string): string => key.replace(/_/g, ' ');

/** Every make, ready for a picker. "Other" is always last. */
export function listMakes(): { key: string; label: string }[] {
  const keys = Object.keys(VEHICLE_CATALOGUE).filter((k) => k !== 'Other');
  keys.sort((a, b) => makeLabel(a).localeCompare(makeLabel(b)));
  return [...keys, 'Other'].map((key) => ({ key, label: makeLabel(key) }));
}

export function listModels(makeKey: string): { model: string; class: VehicleClass }[] {
  return VEHICLE_CATALOGUE[makeKey] || [];
}

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Work out the size class from a make and model.
 *
 * Falls back through: exact catalogue match -> substring match within the make
 * -> any make -> vehicle-type default. Never throws, and never blocks a ride:
 * an unrecognised vehicle is OTHER, which still renders a sensible icon.
 */
export function classifyVehicle(
  make: string | null | undefined,
  model: string | null | undefined,
  vehicleType?: string | null
): VehicleClass {
  if (String(vehicleType).toUpperCase() === 'BIKE') return 'BIKE';

  const m = norm(model);
  if (m) {
    for (const [makeKey, models] of Object.entries(VEHICLE_CATALOGUE)) {
      if (make && norm(makeLabel(makeKey)) !== norm(make)) continue;
      const exact = models.find((x) => norm(x.model) === m);
      if (exact) return exact.class;
    }
    // Model typed loosely ("swift dzire vdi", "creta sx"). Collect every
    // containment match and rank them:
    //   1. longer name wins  — "Nexon EV" beats "Nexon"
    //   2. later position wins on a tie — "Swift Dzire" is a SEDAN, and the
    //      distinguishing word comes second. Length alone gets this wrong,
    //      because "Swift" and "Dzire" are both five letters.
    const matches = Object.values(VEHICLE_CATALOGUE).flat()
      .map((x) => ({ ...x, at: m.indexOf(norm(x.model)), len: norm(x.model).length }))
      .filter((x) => x.at >= 0)
      .sort((a, b) => (b.len - a.len) || (b.at - a.at));
    if (matches.length) return matches[0].class;
  }
  return 'OTHER';
}

/** Everything the rider-facing card needs, in one call. */
export function vehicleSummary(
  make: string | null | undefined,
  model: string | null | undefined,
  vehicleType?: string | null
) {
  const cls = classifyVehicle(make, model, vehicleType);
  return { class: cls, ...VEHICLE_CLASSES[cls] };
}
