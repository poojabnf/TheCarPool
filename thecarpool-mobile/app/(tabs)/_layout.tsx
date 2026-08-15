import { Tabs } from 'expo-router';
import { Platform, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Car, Route, Wallet, User } from 'lucide-react-native';
import { c, font } from '../../theme/tokens';

export default function TabLayout() {
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
          tabBarIcon: ({ color }) => <User color={color} size={21} strokeWidth={2.2} />,
        }}
      />

      {/* Routes kept but not shown as tabs (reached from Home/Rides hubs). */}
      <Tabs.Screen name="driver" options={{ href: null }} />
      <Tabs.Screen name="classifieds" options={{ href: null }} />
    </Tabs>
  );
}
