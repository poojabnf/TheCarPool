/**
 * Pure fare/pricing helpers. No I/O — kept side-effect free so they can be
 * unit-tested directly and reused across payment and AI routes.
 */

export interface SplitResult {
  original_split_per_passenger: number;
  discount_applied: boolean;
  discount_amount: number;
  final_split_charge: number;
}

/**
 * Split a total fare across passengers, applying a 15% group discount when more
 * than one seat is booked. Guards against a zero/negative passenger count
 * (which would otherwise produce Infinity/NaN).
 */
export function calculateSplit(totalFare: number, passengerCount: number, seatsBooked: number): SplitResult {
  const fare = Math.max(0, Number(totalFare) || 0);
  const passengers = Math.max(1, Math.floor(Number(passengerCount) || 1));
  const seats = Math.max(1, Math.floor(Number(seatsBooked) || 1));

  const baseSplit = fare / passengers;
  const discountAmount = seats > 1 ? baseSplit * 0.15 : 0;
  const discountedSplit = baseSplit - discountAmount;

  return {
    original_split_per_passenger: round2(baseSplit),
    discount_applied: discountAmount > 0,
    discount_amount: round2(discountAmount),
    final_split_charge: round2(discountedSplit * seats),
  };
}

export interface PricingResult {
  route_length_km: number;
  vehicle_type: 'CAR' | 'BIKE';
  ac_available: boolean;
  rate_per_km: number;
  suggested_total_compensation: number;
  suggested_passenger_split: number;
}

/** Suggested fair compensation for a route, by vehicle type and AC. */
export function suggestPricing(
  routeLengthKm: number,
  vehicleType: 'CAR' | 'BIKE' = 'CAR',
  acAvailable = true,
  seatsOffered = 1
): PricingResult {
  const km = Math.max(0, Number(routeLengthKm) || 0);
  const baseRatePerKm = vehicleType === 'BIKE' ? 6.0 : 12.0;
  const acMultiplier = vehicleType === 'CAR' && acAvailable ? 2.0 : 0.0;
  const finalRatePerKm = baseRatePerKm + acMultiplier;
  const suggestedTotal = km * finalRatePerKm;

  // Split across everyone in the vehicle, driver included.
  //
  // suggested_passenger_split used to equal the whole total, so a 468 km
  // Jhansi-Delhi run suggested ₹6,552 PER SEAT — the entire cost of the
  // journey, charged to each rider. That is not cost-sharing, it is three
  // people each funding the trip outright, and it made the suggestion
  // useless enough that drivers typed over it with a number like ₹20.
  //
  // The driver counts as one occupant: they get where they are going too, so
  // bearing a share is the point. It also keeps the suggestion on the right
  // side of carpooling being cost recovery rather than a fare.
  const occupants = Math.max(1, Math.floor(Number(seatsOffered) || 0)) + 1;

  return {
    route_length_km: km,
    vehicle_type: vehicleType,
    ac_available: acAvailable,
    rate_per_km: finalRatePerKm,
    suggested_total_compensation: round2(suggestedTotal),
    suggested_passenger_split: round2(suggestedTotal / occupants),
  };
}

const TAXI_RATE_PER_KM = 12;
const CARPOOL_RATE_PER_KM = 4;

/** Estimated rupee + fuel savings from pooling vs solo taxi over `totalKm`. */
export function fuelSavings(totalKm: number) {
  const km = Math.max(0, Number(totalKm) || 0);
  const equivalentTaxiCost = km * TAXI_RATE_PER_KM;
  const carpoolCost = km * CARPOOL_RATE_PER_KM;
  return {
    total_commute_kms: round1(km),
    equivalent_taxi_cost: round2(equivalentTaxiCost),
    thecarpool_cost: round2(carpoolCost),
    total_fuel_saved_inr: round2(equivalentTaxiCost - carpoolCost),
    prevented_fuel_liters: round1((km * 3.5) / 100),
  };
}

function round2(n: number): number {
  return parseFloat((Number.isFinite(n) ? n : 0).toFixed(2));
}
function round1(n: number): number {
  return parseFloat((Number.isFinite(n) ? n : 0).toFixed(1));
}
