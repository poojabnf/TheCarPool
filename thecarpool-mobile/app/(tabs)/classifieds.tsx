import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, MessageSquare, Tag, X } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../../theme/tokens';

interface Ad {
  id: number; title: string; description: string;
  category: 'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE' | 'OTHER';
  price?: string; poster_name: string; poster_company: string; poster_society: string;
  mutual_count: number; created_at: string;
}

const SEED: Ad[] = [
  { id: 1, title: 'Master Room in 3BHK Apartment', description: 'Roommate wanted in DLF Phase 5. Semi-furnished, attached bath, gym access. Prefer Google/TCS coworkers.', category: 'FLATMATE', price: '₹16,500/month', poster_name: 'Pooja Yadav', poster_company: 'Google', poster_society: 'DLF Phase 5', mutual_count: 0, created_at: 'Just now' },
  { id: 2, title: 'Apple Magic Keyboard 2', description: 'Mint condition, barely used 2 months, original packaging. Collect from Cyber City Building 10.', category: 'BUY_SELL', price: '₹5,200', poster_name: 'Rohan Kapoor', poster_company: 'TCS', poster_society: 'Central Park 2', mutual_count: 1, created_at: '2 hours ago' },
  { id: 3, title: 'Ride Share: Noida Sec 62 → Cyber City', description: 'Sharing my pool route on the tollway. Monthly seat lease split. Honda City, AC + charging.', category: 'ITEM_SHARE', price: '₹180/trip', poster_name: 'Neha Goel', poster_company: 'Google', poster_society: 'ATS One Hamlet', mutual_count: 5, created_at: '1 day ago' },
];

function initials(n: string) { return n.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join(''); }

export default function ClassifiedsScreen() {
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE'>('ALL');
  const [showPost, setShowPost] = useState(false);
  const [ads, setAds] = useState<Ad[]>(SEED);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE'>('FLATMATE');
  const [price, setPrice] = useState('');

  const filtered = activeCategory === 'ALL' ? ads : ads.filter((a) => a.category === activeCategory);

  const post = () => {
    if (!title || !description) { Alert.alert('Add details', 'Please fill in a title and description.'); return; }
    setAds([{ id: Date.now(), title, description, category, price: price ? `₹${price}` : undefined, poster_name: 'You', poster_company: 'Google', poster_society: 'DLF Phase 5', mutual_count: 0, created_at: 'Just now' }, ...ads]);
    setTitle(''); setDescription(''); setPrice(''); setShowPost(false);
    Alert.alert('Posted', 'Your listing is live on the community board.');
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.sm }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>Classifieds</Text>
          <Text style={styles.headerSub}>Your workplace & society community board</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowPost(true)} activeOpacity={0.9}>
          <Plus color="#fff" size={20} strokeWidth={2.6} />
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ paddingHorizontal: space.xl, gap: 8 }}>
        {(['ALL', 'FLATMATE', 'BUY_SELL', 'ITEM_SHARE'] as const).map((cat) => {
          const on = activeCategory === cat;
          return (
            <TouchableOpacity key={cat} style={[styles.tab, on && styles.tabOn]} onPress={() => setActiveCategory(cat)}>
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{cat === 'ALL' ? 'All' : cat.replace('_', ' ')}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: space.xl, paddingTop: space.md }} showsVerticalScrollIndicator={false}>
        {filtered.map((ad) => (
          <View key={ad.id} style={styles.card}>
            <View style={styles.cardTop}>
              <View style={styles.catBadge}><Tag size={10} color={c.textAccent} /><Text style={styles.catBadgeText}>{ad.category.replace('_', ' ')}</Text></View>
              <Text style={styles.time}>{ad.created_at}</Text>
            </View>
            <Text style={styles.title}>{ad.title}</Text>
            <Text style={styles.desc}>{ad.description}</Text>
            {ad.price && <Text style={styles.price}>{ad.price}</Text>}
            <View style={styles.poster}>
              <View style={styles.disc}><Text style={styles.discText}>{initials(ad.poster_name)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.posterName}>{ad.poster_name}</Text>
                <Text style={styles.posterMeta}>{ad.poster_company} · {ad.poster_society}{ad.mutual_count > 0 ? ` · ${ad.mutual_count} mutual` : ''}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.msgBtn} onPress={() => Alert.alert('Message', `Opening chat with ${ad.poster_name}…`)} activeOpacity={0.9}>
              <MessageSquare size={15} color="#fff" strokeWidth={2.2} /><Text style={styles.msgText}>Message</Text>
            </TouchableOpacity>
          </View>
        ))}
        {filtered.length === 0 && <Text style={styles.empty}>No listings in this category yet.</Text>}
      </ScrollView>

      <Modal visible={showPost} animationType="slide" transparent onRequestClose={() => setShowPost(false)}>
        <View style={styles.modalBg}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Post a listing</Text>
              <TouchableOpacity onPress={() => setShowPost(false)}><X color={c.textTertiary} size={22} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.label}>Category</Text>
              <View style={styles.catRow}>
                {(['FLATMATE', 'BUY_SELL', 'ITEM_SHARE'] as const).map((cat) => {
                  const on = category === cat;
                  return (
                    <TouchableOpacity key={cat} style={[styles.catChip, on && styles.catChipOn]} onPress={() => setCategory(cat)}>
                      <Text style={[styles.catChipText, on && { color: '#fff' }]}>{cat.replace('_', ' ')}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.label}>Title</Text>
              <TextInput style={styles.input} placeholder="e.g. Master bedroom in Phase 5" placeholderTextColor={c.textDisabled} value={title} onChangeText={setTitle} />
              <Text style={styles.label}>Description</Text>
              <TextInput style={[styles.input, { height: 90, paddingTop: 12 }]} multiline placeholder="Details about the room, item, or share…" placeholderTextColor={c.textDisabled} value={description} onChangeText={setDescription} />
              <Text style={styles.label}>Price (optional)</Text>
              <TextInput style={styles.input} placeholder="e.g. 15,000/month" placeholderTextColor={c.textDisabled} value={price} onChangeText={setPrice} />
              <TouchableOpacity style={styles.publish} onPress={post} activeOpacity={0.9}><Text style={styles.publishText}>Publish listing</Text></TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bgApp },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: space.xl, marginBottom: space.md },
  h1: { fontFamily: font.sansExtrabold, fontSize: 26, color: c.textPrimary, letterSpacing: -0.5 },
  headerSub: { fontFamily: font.sans, fontSize: 12.5, color: c.textTertiary, marginTop: 2 },
  addBtn: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: c.actionPrimary, alignItems: 'center', justifyContent: 'center' },

  tabs: { maxHeight: 40, marginBottom: 4 },
  tab: { paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: radius.pill, backgroundColor: c.surfaceCard, borderWidth: 1, borderColor: c.borderSubtle },
  tabOn: { backgroundColor: c.textPrimary, borderColor: c.textPrimary },
  tabText: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.textSecondary },
  tabTextOn: { color: '#fff' },

  card: { backgroundColor: c.surfaceCard, borderRadius: radius.lg, padding: space.lg, marginBottom: space.md, borderWidth: 1, borderColor: c.borderSubtle, ...shadowSm },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  catBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.accentSoft, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  catBadgeText: { fontFamily: font.sansSemibold, fontSize: 10, color: c.textAccent, textTransform: 'uppercase' },
  time: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary },
  title: { fontFamily: font.sansBold, fontSize: 16.5, color: c.textPrimary, marginBottom: 6 },
  desc: { fontFamily: font.sans, fontSize: 13.5, color: c.textSecondary, lineHeight: 20, marginBottom: 10 },
  price: { fontFamily: font.monoBold, fontSize: 15, color: c.goStrong, marginBottom: space.md },
  poster: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surfaceSunken, borderRadius: radius.md, padding: space.sm, marginBottom: space.md },
  disc: { width: 32, height: 32, borderRadius: radius.pill, backgroundColor: c.surfaceInset, alignItems: 'center', justifyContent: 'center' },
  discText: { fontFamily: font.sansBold, fontSize: 11, color: c.textSecondary },
  posterName: { fontFamily: font.sansSemibold, fontSize: 13, color: c.textPrimary },
  posterMeta: { fontFamily: font.sans, fontSize: 11, color: c.textTertiary, marginTop: 1 },
  msgBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: c.actionPrimary, borderRadius: radius.md, height: 44 },
  msgText: { fontFamily: font.sansBold, fontSize: 14, color: '#fff' },
  empty: { fontFamily: font.sans, color: c.textTertiary, textAlign: 'center', marginTop: 40, fontSize: 14 },

  modalBg: { flex: 1, backgroundColor: 'rgba(11,15,20,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgBase, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, maxHeight: '88%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.lg },
  sheetTitle: { fontFamily: font.sansBold, fontSize: 18, color: c.textPrimary },
  label: { fontFamily: font.sansSemibold, fontSize: 12.5, color: c.textSecondary, marginBottom: 7, marginTop: space.md },
  input: { backgroundColor: c.surfaceSunken, borderRadius: radius.md, minHeight: 48, paddingHorizontal: 14, fontFamily: font.sansMedium, fontSize: 15, color: c.textPrimary, borderWidth: 1, borderColor: c.borderSubtle },
  catRow: { flexDirection: 'row', gap: 8 },
  catChip: { flex: 1, height: 40, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surfaceSunken, borderWidth: 1, borderColor: c.borderSubtle },
  catChipOn: { backgroundColor: c.textPrimary, borderColor: c.textPrimary },
  catChipText: { fontFamily: font.sansSemibold, fontSize: 11.5, color: c.textSecondary },
  publish: { backgroundColor: c.go, borderRadius: radius.md, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: space.xl },
  publishText: { fontFamily: font.sansBold, fontSize: 16, color: '#fff' },
});
