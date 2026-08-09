// Jest is the project test runner; describe/it/expect are globals.
import {
  classifyVehicle,
  vehicleSummary,
  listMakes,
  listModels,
  VEHICLE_CLASSES,
  makeLabel,
} from '../vehicles';

describe('classifyVehicle', () => {
  it('classifies common Indian cars by size, not by badge', () => {
    expect(classifyVehicle('Maruti Suzuki', 'Swift')).toBe('HATCHBACK');
    expect(classifyVehicle('Maruti Suzuki', 'Dzire')).toBe('SEDAN');
    expect(classifyVehicle('Hyundai', 'Creta')).toBe('SUV');
    expect(classifyVehicle('Toyota', 'Innova Crysta')).toBe('MPV');
    expect(classifyVehicle('BMW', '3 Series')).toBe('LUXURY');
  });

  it('is case and spacing insensitive', () => {
    expect(classifyVehicle('maruti suzuki', '  swift ')).toBe('HATCHBACK');
    expect(classifyVehicle('HYUNDAI', 'CRETA')).toBe('SUV');
  });

  it('handles a loosely typed model', () => {
    // Drivers type variants; "Swift Dzire" is a sedan, not a hatchback.
    expect(classifyVehicle('Maruti Suzuki', 'Swift Dzire VDI')).toBe('SEDAN');
    expect(classifyVehicle('Hyundai', 'Creta SX(O)')).toBe('SUV');
  });

  it('prefers the longer model name when one contains another', () => {
    // "Nexon EV" must not be swallowed by "Nexon".
    expect(classifyVehicle('Tata', 'Nexon EV')).toBe('SUV');
    expect(classifyVehicle('Maruti Suzuki', 'Tiago EV')).toBe('HATCHBACK');
  });

  it('treats anything on two wheels as BIKE regardless of model', () => {
    // vehicleType wins — a bike is a bike even if the model is unknown.
    expect(classifyVehicle('Hero', 'Splendor', 'BIKE')).toBe('BIKE');
    expect(classifyVehicle('Some Brand', 'Unknown 250', 'BIKE')).toBe('BIKE');
  });

  it('falls back to OTHER for an unknown vehicle rather than throwing', () => {
    // An unrecognised car must never block someone from offering a ride.
    expect(classifyVehicle('Rivian', 'R1T')).toBe('OTHER');
    expect(classifyVehicle('', '')).toBe('OTHER');
    expect(classifyVehicle(null, null)).toBe('OTHER');
    expect(classifyVehicle(undefined, undefined)).toBe('OTHER');
  });

  it('still classifies when the make is missing but the model is known', () => {
    // "Other" make + typed model is the manual-entry path.
    expect(classifyVehicle('Other', 'Ertiga')).toBe('MPV');
    expect(classifyVehicle(null, 'Fortuner')).toBe('SUV');
  });
});

describe('vehicleSummary', () => {
  it('returns the class with rider-facing copy', () => {
    const s = vehicleSummary('Toyota', 'Innova Crysta');
    expect(s.class).toBe('MPV');
    expect(s.label).toBe('MPV / Van');
    expect(s.typicalSeats).toBe(6);
  });

  it('gives a usable summary for an unknown vehicle', () => {
    const s = vehicleSummary('Unknown', 'Thing');
    expect(s.class).toBe('OTHER');
    expect(s.label).toBeTruthy();
    expect(s.typicalSeats).toBeGreaterThan(0);
  });
});

describe('catalogue', () => {
  it('lists makes alphabetically with Other last', () => {
    const makes = listMakes();
    expect(makes[makes.length - 1].key).toBe('Other');
    const labels = makes.slice(0, -1).map((m) => m.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
  });

  it('turns catalogue keys into readable labels', () => {
    expect(makeLabel('Maruti_Suzuki')).toBe('Maruti Suzuki');
    expect(makeLabel('Royal_Enfield')).toBe('Royal Enfield');
  });

  it('returns models for a make and an empty list for Other', () => {
    expect(listModels('Tata').some((m) => m.model === 'Nexon')).toBe(true);
    expect(listModels('Other')).toEqual([]);
    expect(listModels('NotAMake')).toEqual([]);
  });

  it('gives every model a class that exists', () => {
    for (const [make, models] of Object.entries({ Tata: listModels('Tata'), Kia: listModels('Kia') })) {
      for (const m of models) {
        expect(VEHICLE_CLASSES[m.class]).toBeDefined();
      }
    }
  });
});
