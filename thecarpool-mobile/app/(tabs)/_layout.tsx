import { Tabs } from 'expo-router';
import { Platform, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Car, Route, Wallet, User } from 'lucide-react-native';
import { c, font } from '../../theme/tokens';
import { useI18n } from '../services/i18n';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
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
        options={{ title: t('tab_home'), tabBarIcon: ({ color }) => <Home color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="rides"
        options={{ title: t('tab_rides'), tabBarIcon: ({ color }) => <Car color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="trips"
        options={{ title: t('tab_trips'), tabBarIcon: ({ color }) => <Route color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: t('tab_wallet'), tabBarIcon: ({ color }) => <Wallet color={color} size={21} strokeWidth={2.2} /> }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('tab_account'),
          tabBarIcon: ({ color }) => <User color={color} size={21} strokeWidth={2.2} />,
        }}
      />

      {/* Routes kept but not shown as tabs (reached from Home/Rides hubs). */}
      <Tabs.Screen name="driver" options={{ href: null }} />
    </Tabs>
  );
}
