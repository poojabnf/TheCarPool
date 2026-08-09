import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Car, CarFront, Van, Bus, Bike } from 'lucide-react-native';
import { c, font } from '../../theme/tokens';

/**
 * Vehicle size classes, mirroring lib/vehicles.ts on the backend. The server
 * decides the class; this only draws it.
 */
export type VehicleClass = 'HATCHBACK' | 'SEDAN' | 'SUV' | 'MPV' | 'LUXURY' | 'BIKE' | 'OTHER';

/**
 * Icon and relative size per class.
 *
 * The glyph AND the size both change: a rider scanning a list of matches reads
 * "how much room is this" from the silhouette long before they read the model
 * name, so a bigger vehicle has to look bigger. Using one glyph at one size
 * with different text would defeat the point.
 */
const LOOK: Record<VehicleClass, { Icon: any; size: number; label: string }> = {
  HATCHBACK: { Icon: Car,      size: 16, label: 'Hatchback' },
  SEDAN:     { Icon: Car,      size: 20, label: 'Sedan' },
  SUV:       { Icon: CarFront, size: 23, label: 'SUV' },
  MPV:       { Icon: Van,      size: 25, label: 'MPV' },
  LUXURY:    { Icon: CarFront, size: 21, label: 'Luxury' },
  BIKE:      { Icon: Bike,     size: 18, label: 'Bike' },
  OTHER:     { Icon: Car,      size: 19, label: 'Vehicle' },
};

export default function VehicleIcon({
  vehicleClass,
  color = c.textSecondary,
  showLabel = false,
}: {
  vehicleClass?: VehicleClass | string | null;
  color?: string;
  showLabel?: boolean;
}) {
  const look = LOOK[(vehicleClass as VehicleClass) in LOOK ? (vehicleClass as VehicleClass) : 'OTHER'];
  const { Icon } = look;
  return (
    <View style={styles.row}>
      {/* Fixed-width box so differing icon sizes don't shift the text beside
          them — the size difference should read as the vehicle, not as a
          wobbling layout. */}
      <View style={styles.iconBox}>
        <Icon color={color} size={look.size} strokeWidth={2.1} />
      </View>
      {showLabel && <Text style={[styles.label, { color }]}>{look.label}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  iconBox: { width: 26, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: font.sansMedium, fontSize: 12 },
});
