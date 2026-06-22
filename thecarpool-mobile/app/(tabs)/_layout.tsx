import { Tabs } from 'expo-router';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Car, Route, Wallet, User } from 'lucide-react-native';
import { useAuthStore } from '../store/authStore';
import { c, font } from '../../theme/tokens';

function KycDot() {
  return <View style={styles.kycDot} />;
}

export default function TabLayout() {
  const { kycStatus } = useAuthStore();
  const kycPending = kycStatus !== 'verified';
  const insets = useSafeAreaInsets();
  const BAR = 58;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: c.bgBase,
          borderTopWidth: 1,
          borderTopColor: c.borderSubtle,
          height: BAR + insets.bottom,
          paddingBottom: insets.bottom + (Platform.OS === 'android' ? 8 : 6),
          paddingTop: 8,
        },
        tabBarActiveTintColor: c.textPrimary,
        tabBarInactiveTintColor: c.textDisabled,
        tabBarLabelStyle: { fontSize: 11, fontFamily: font.sansSemibold, marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color }) => <Home color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="rides"
        options={{ title: 'Rides', tabBarIcon: ({ color }) => <Car color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="trips"
        options={{ title: 'Trips', tabBarIcon: ({ color }) => <Route color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: 'Wallet', tabBarIcon: ({ color }) => <Wallet color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'You',
          tabBarIcon: ({ color }) => (
            <View>
              <User color={color} size={21} strokeWidth={2.2} />
              {kycPending && <KycDot />}
            </View>
          ),
        }}
      />

      {/* Routes kept but not shown as tabs (reached from Home/Rides hubs). */}
      <Tabs.Screen name="driver" options={{ href: null }} />
      <Tabs.Screen name="classifieds" options={{ href: null }} />
      <Tabs.Screen name="kyc" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  kycDot: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.accent,
  },
});
