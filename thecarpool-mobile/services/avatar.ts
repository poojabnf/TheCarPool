import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch } from './api';

/**
 * Let the user pick a profile photo from the camera or gallery, upload it to the
 * backend (base64 → Firebase Storage), and return the resulting signed photo
 * URL. Returns null if the user cancels or something fails (already alerted).
 */
export async function pickAndUploadAvatar(source: 'camera' | 'library'): Promise<string | null> {
  try {
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Camera access needed', 'Enable camera access in Settings to take a photo.'); return null; }
    } else {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Photos access needed', 'Enable photo access in Settings to choose a picture.'); return null; }
    }

    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);

    if (result.canceled || !result.assets?.[0]?.base64) return null;
    const asset = result.assets[0];

    const res = await apiFetch('/api/users/photo', {
      method: 'POST',
      body: JSON.stringify({ image_base64: asset.base64, content_type: asset.mimeType || 'image/jpeg' }),
    }, { timeoutMs: 30000 });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      Alert.alert('Upload failed', e.error || `Server error (${res.status}).`);
      return null;
    }
    const data = await res.json();
    return data.photo_url as string;
  } catch (err: any) {
    Alert.alert('Upload failed', err?.message || 'Could not set your photo. Please try again.');
    return null;
  }
}

/** Prompt the user to choose camera or gallery, then upload. */
export function chooseAndUploadAvatar(onDone: (url: string) => void) {
  Alert.alert('Profile photo', 'Choose a photo source', [
    { text: 'Take photo', onPress: async () => { const u = await pickAndUploadAvatar('camera'); if (u) onDone(u); } },
    { text: 'Choose from gallery', onPress: async () => { const u = await pickAndUploadAvatar('library'); if (u) onDone(u); } },
    { text: 'Cancel', style: 'cancel' },
  ]);
}
