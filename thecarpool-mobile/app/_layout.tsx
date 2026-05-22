import React, { useState } from 'react';
import { Stack } from "expo-router";
import { StatusBar, View, Text, TextInput, TouchableOpacity, StyleSheet, Modal } from "react-native";
import { Lock } from 'lucide-react-native';

export default function RootLayout() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [mobile, setMobile] = useState('');

  const handleLogin = () => {
    if (firstName.trim() && mobile.trim()) {
      setIsAuthenticated(true);
    }
  };

  return (
    <>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* Global Auth Gate */}
      <Modal visible={!isAuthenticated} animationType="slide">
        <View style={styles.authContainer}>
          <Lock color="#10b981" size={48} style={{ marginBottom: 20 }} />
          <Text style={styles.authTitle}>Secure Sign Up</Text>
          <Text style={styles.authSub}>Create your TheCarPool profile to start riding.</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>First Name *</Text>
            <TextInput style={styles.input} placeholder="e.g. Pooja" value={firstName} onChangeText={setFirstName} />
          </View>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Last Name</Text>
            <TextInput style={styles.input} placeholder="Optional" />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Mobile Number *</Text>
            <TextInput style={styles.input} placeholder="+91 9876543210" keyboardType="phone-pad" value={mobile} onChangeText={setMobile} />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput style={styles.input} placeholder="Optional" keyboardType="email-address" autoCapitalize="none" />
          </View>

          <TouchableOpacity style={styles.authButton} onPress={handleLogin}>
            <Text style={styles.authBtnText}>Continue</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Main App Stack (Rendered behind the modal or when authenticated) */}
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#ffffff' } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="components/AiVoiceModal" options={{ presentation: 'modal' }} />
        <Stack.Screen name="components/KycUploadModal" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  authContainer: { flex: 1, backgroundColor: '#f8fafc', padding: 30, justifyContent: 'center' },
  authTitle: { fontSize: 32, fontWeight: 'bold', color: '#0f172a', marginBottom: 8 },
  authSub: { fontSize: 16, color: '#64748b', marginBottom: 32 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 12, fontWeight: 'bold', color: '#64748b', marginBottom: 6, textTransform: 'uppercase' },
  input: { backgroundColor: 'white', padding: 16, borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', fontSize: 16 },
  authButton: { backgroundColor: '#10b981', padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  authBtnText: { color: 'white', fontSize: 18, fontWeight: 'bold' }
});
