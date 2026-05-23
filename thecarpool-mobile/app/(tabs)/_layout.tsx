import { Tabs, useRouter } from 'expo-router';
import { Platform, View, Text, StyleSheet } from 'react-native';
import { Search, Car, User } from 'lucide-react-native';
import { useAuthStore } from '../store/authStore';

function KycBadge() {
  return (
    <View style={styles.kycBadge}>
      <Text style={styles.kycBadgeText}>!</Text>
    </View>
  );
}

export default function TabLayout() {
  const { kycStatus } = useAuthStore();
  const kycPending = kycStatus !== 'verified';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#080c14',
          borderTopWidth: 1,
          borderTopColor: '#1f2d47',
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 10,
        },
        tabBarActiveTintColor: '#10b981',
        tabBarInactiveTintColor: '#4b5563',
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Find a Ride',
          tabBarIcon: ({ color }) => <Search color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="driver"
        options={{
          title: 'Offer a Ride',
          tabBarIcon: ({ color }) => <Car color={color} size={22} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, focused }) => (
            <View>
              <User color={color} size={22} />
              {kycPending && <KycBadge />}
            </View>
          ),
        }}
      />
      {/* Hidden tabs — prevent them appearing in tab bar */}
      <Tabs.Screen name="home" options={{ href: null }} />
      <Tabs.Screen name="kyc" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  kycBadge: {
    position: 'absolute',
    top: -4,
    right: -6,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ff6b35',
    alignItems: 'center',
    justifyContent: 'center',
  },
  kycBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
});
