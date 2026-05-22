import { Tabs } from "expo-router";
import { Platform } from "react-native";
import { Search, Car } from "lucide-react-native";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: '#e2e8f0',
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 10,
        },
        tabBarActiveTintColor: '#10b981', // Emerald Green
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Find a Ride",
          tabBarIcon: ({ color }) => <Search color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="driver"
        options={{
          title: "Offer a Ride",
          tabBarIcon: ({ color }) => <Car color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color }) => <Search color={color} size={24} />, // Reusing Search icon or we should import User
        }}
      />
    </Tabs>
  );
}
