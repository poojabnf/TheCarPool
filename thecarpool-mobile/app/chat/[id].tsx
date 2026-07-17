import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import io from 'socket.io-client';
import { Send } from 'lucide-react-native';
import { auth } from '../services/firebase';
import { API_URL, apiFetch } from '../services/api';
import * as haptics from '../services/haptics';
import { c, font, radius, space } from '../../theme/tokens';

type ChatMessage = {
  id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at: string;
};

export default function ChatScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myUid = auth().currentUser?.uid;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // History + realtime subscription over the same authed socket the trip screen uses.
  useEffect(() => {
    let socket: ReturnType<typeof io> | undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/chat/${id}/messages`);
        if (cancelled) return;
        if (res.status === 403) { setBlocked(true); return; }
        if (res.ok) {
          const data = await res.json();
          setMessages(data.messages || []);
        }
      } catch { /* offline — realtime may still connect */ }
      finally { if (!cancelled) setLoading(false); }

      const token = await auth().currentUser?.getIdToken();
      if (cancelled) return;
      socket = io(API_URL, { auth: { token } });
      socket.on('connect', () => socket?.emit('ride:join', id));
      socket.on('chat:message', (msg: ChatMessage & { ride_id: string }) => {
        if (String(msg.ride_id) !== String(id)) return;
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      });
    })();
    return () => { cancelled = true; socket?.disconnect(); };
  }, [id]);

  useEffect(() => {
    // Keep the newest message in view.
    if (messages.length) setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
  }, [messages.length]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const res = await apiFetch(`/api/chat/${id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        haptics.tap();
        const saved = await res.json();
        setDraft('');
        // Echo locally — the socket broadcast dedupes by id.
        setMessages((prev) => (prev.some((m) => m.id === saved.id) ? prev : [...prev, saved]));
      }
    } catch { /* keep the draft so the user can retry */ }
    finally { setSending(false); }
  }, [draft, id, sending]);

  const renderItem = ({ item }: { item: ChatMessage }) => {
    const mine = item.sender_id === myUid;
    return (
      <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {!mine && <Text style={styles.sender}>{item.sender_name}</Text>}
          <Text style={[styles.msgText, mine && { color: '#fff' }]}>{item.text}</Text>
          <Text style={[styles.time, mine && { color: 'rgba(255,255,255,0.7)' }]}>
            {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}>
          <Text style={styles.back}>←</Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Trip chat</Text>
          <Text style={styles.subtitle}>Trip #{String(id).slice(0, 8)} · numbers stay private</Text>
        </View>
      </View>

      {/* Messages */}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={c.textSecondary} /></View>
      ) : blocked ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Chat unavailable</Text>
          <Text style={styles.emptyText}>Only the driver and booked riders can chat on this trip.</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Say hello 👋</Text>
          <Text style={styles.emptyText}>Coordinate your pickup here — no phone numbers needed.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
        />
      )}

      {/* Composer */}
      {!blocked && (
        <View style={[styles.composer, { paddingBottom: insets.bottom + space.sm }]}>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor={c.textTertiary}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={1000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
            onPress={send}
            disabled={!draft.trim() || sending}
            activeOpacity={0.9}
          >
            <Send color="#fff" size={18} strokeWidth={2.2} />
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingBottom: space.md,
    backgroundColor: c.bgBase, borderBottomWidth: 1, borderColor: c.borderSubtle,
  },
  back: { fontSize: 24, color: c.textPrimary, paddingRight: 4 },
  title: { fontFamily: font.sansBold, fontSize: 17, color: c.textPrimary },
  subtitle: { fontFamily: font.sans, fontSize: 12, color: c.textTertiary, marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },
  emptyTitle: { fontFamily: font.sansBold, fontSize: 17, color: c.textPrimary, marginBottom: 6 },
  emptyText: { fontFamily: font.sans, fontSize: 13.5, color: c.textTertiary, textAlign: 'center' },

  bubbleRow: { flexDirection: 'row', marginBottom: space.sm },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMine: { backgroundColor: c.textPrimary, borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: c.surfaceCard, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: c.borderSubtle },
  sender: { fontFamily: font.sansSemibold, fontSize: 11.5, color: c.go, marginBottom: 2 },
  msgText: { fontFamily: font.sans, fontSize: 14.5, color: c.textPrimary, lineHeight: 20 },
  time: { fontFamily: font.sans, fontSize: 10.5, color: c.textTertiary, marginTop: 4, alignSelf: 'flex-end' },

  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: space.sm,
    paddingHorizontal: space.lg, paddingTop: space.sm,
    backgroundColor: c.bgBase, borderTopWidth: 1, borderColor: c.borderSubtle,
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120, backgroundColor: c.surfaceSunken,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11,
    fontFamily: font.sans, fontSize: 14.5, color: c.textPrimary,
    borderWidth: 1, borderColor: c.borderSubtle,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: radius.md, backgroundColor: c.go,
    alignItems: 'center', justifyContent: 'center',
  },
});
