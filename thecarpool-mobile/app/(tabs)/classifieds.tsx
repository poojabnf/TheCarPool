import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, Alert, Modal } from 'react-native';
import { Newspaper, Plus, ShieldCheck, MessageSquare, Tag, X } from 'lucide-react-native';
import { colors } from '../../theme/colors';

function Linkedin({ size = 16, color, style }: { size?: number; color?: string; style?: any }) {
  return (
    <View style={[{
      width: size,
      height: size,
      backgroundColor: '#0077b5',
      borderRadius: 3,
      alignItems: 'center',
      justifyContent: 'center',
    }, style]}>
      <Text style={{
        color: '#ffffff',
        fontSize: size * 0.7,
        fontWeight: 'bold',
        lineHeight: size * 0.75,
        textAlign: 'center',
      }}>in</Text>
    </View>
  );
}

interface Ad {
  id: number;
  title: string;
  description: string;
  category: 'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE' | 'OTHER';
  price?: string;
  poster_name: string;
  poster_company: string;
  poster_society: string;
  linkedin_connections: number;
  mutual_count: number;
  created_at: string;
}

export default function ClassifiedsScreen() {
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE'>('ALL');
  const [showPostModal, setShowPostModal] = useState(false);
  
  // New Ad Form States
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<'FLATMATE' | 'BUY_SELL' | 'ITEM_SHARE' | 'OTHER'>('FLATMATE');
  const [price, setPrice] = useState('');

  const [ads, setAds] = useState<Ad[]>([
    {
      id: 1,
      title: "Master Room in 3BHK Apartment",
      description: "Looking for a roommate (flatmate) in DLF Phase 5. Semi-furnished room, attached bathroom, fully working kitchen, gym access. Prefer Google/TCS employees.",
      category: 'FLATMATE',
      price: "₹16,500/month",
      poster_name: "Pooja Yadav",
      poster_company: "Google",
      poster_society: "DLF Phase 5",
      linkedin_connections: 320,
      mutual_count: 0, // Current user
      created_at: "Just Now",
    },
    {
      id: 2,
      title: "Apple Magic Keyboard 2",
      description: "Selling Magic Keyboard in mint condition. Barely used for 2 months, original packaging available. Can collect from DLF Cyber City Building 10 during office hours.",
      category: 'BUY_SELL',
      price: "₹5,200",
      poster_name: "Rohan Kapoor",
      poster_company: "TCS",
      poster_society: "Central Park 2",
      linkedin_connections: 92,
      mutual_count: 1,
      created_at: "2 hours ago",
    },
    {
      id: 3,
      title: "Daily Ride Share: Noida Sec 62 to Cyber City",
      description: "Looking to share my car pool route on tollway. Offering monthly seat lease split. Car: Honda City with comfy AC & charging point.",
      category: 'ITEM_SHARE',
      price: "₹180/trip",
      poster_name: "Neha Goel",
      poster_company: "Google",
      poster_society: "Ats One Hamlet",
      linkedin_connections: 312,
      mutual_count: 5,
      created_at: "1 day ago",
    }
  ]);

  const filteredAds = activeCategory === 'ALL' 
    ? ads 
    : ads.filter(ad => ad.category === activeCategory);

  const handlePostAd = () => {
    if (!title || !description) {
      Alert.alert('Error', 'Please fill in Title and Description.');
      return;
    }

    const newAd: Ad = {
      id: ads.length + 1,
      title,
      description,
      category,
      price: price ? `₹${price}` : undefined,
      poster_name: "Pooja Yadav",
      poster_company: "Google",
      poster_society: "DLF Phase 5",
      linkedin_connections: 320,
      mutual_count: 0,
      created_at: "Just Now",
    };

    setAds([newAd, ...ads]);
    setTitle('');
    setDescription('');
    setPrice('');
    setShowPostModal(false);
    Alert.alert('Success', 'Your classified ad has been posted to your community board.');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
          <View style={styles.logoBox}><Newspaper color="#fff" size={18} /></View>
          <View>
            <Text style={styles.headerTitle}>Community Board</Text>
            <Text style={styles.headerSub}>DLF Phase 5 & Tech Park Circle</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowPostModal(true)}>
          <Plus color="#fff" size={20} />
        </TouchableOpacity>
      </View>

      {/* Category Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabRow} contentContainerStyle={{paddingRight: 20}}>
        {(['ALL', 'FLATMATE', 'BUY_SELL', 'ITEM_SHARE'] as const).map(cat => {
          const active = activeCategory === cat;
          return (
            <TouchableOpacity 
              key={cat} 
              style={[styles.tabBtn, active && styles.tabBtnActive]} 
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>
                {cat === 'ALL' ? 'All Posts' : cat.replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Listings */}
      <ScrollView style={styles.listings} showsVerticalScrollIndicator={false}>
        {filteredAds.map(ad => (
          <View key={ad.id} style={styles.adCard}>
            <View style={styles.adCardHeader}>
              <View style={styles.categoryBadge}>
                <Tag size={10} color={colors.primary} style={{marginRight: 4}} />
                <Text style={styles.categoryBadgeText}>{ad.category.replace('_', ' ')}</Text>
              </View>
              <Text style={styles.timeText}>{ad.created_at}</Text>
            </View>

            <Text style={styles.adTitle}>{ad.title}</Text>
            <Text style={styles.adDesc}>{ad.description}</Text>

            {ad.price && (
              <View style={styles.priceRow}>
                <Text style={styles.priceLabel}>Price / Cost:</Text>
                <Text style={styles.priceValue}>{ad.price}</Text>
              </View>
            )}

            {/* Poster Info */}
            <View style={styles.posterBox}>
              <View style={styles.posterHeader}>
                <View style={styles.avatarMini} />
                <View style={{flex: 1}}>
                  <Text style={styles.posterName}>{ad.poster_name}</Text>
                  <Text style={styles.posterDetails}>
                    🏢 {ad.poster_company} Coworker • 🏠 {ad.poster_society}
                  </Text>
                </View>
              </View>

              {/* LinkedIn Social Trust */}
              <View style={styles.linkedinBadge}>
                <Linkedin size={12} color="#0077b5" style={{marginRight: 4}} />
                <Text style={styles.linkedinText}>
                  {ad.mutual_count > 0 ? `${ad.mutual_count} mutual connections` : 'LinkedIn Profile Verified'}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.chatBtn} onPress={() => Alert.alert('Chat Initiated', `Opening message session with ${ad.poster_name}...`)}>
              <MessageSquare size={16} color="#fff" style={{marginRight: 6}} />
              <Text style={styles.chatBtnText}>Message Member</Text>
            </TouchableOpacity>
          </View>
        ))}
        {filteredAds.length === 0 && (
          <Text style={styles.noPostsText}>No community ads posted in this category yet.</Text>
        )}
      </ScrollView>

      {/* Post Modal */}
      <Modal visible={showPostModal} animationType="slide" transparent={true}>
        <View style={styles.modalBg}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Post to Community Board</Text>
              <TouchableOpacity onPress={() => setShowPostModal(false)}>
                <X color={colors.textMuted} size={24} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Select Category</Text>
                <View style={styles.catSelectRow}>
                  {(['FLATMATE', 'BUY_SELL', 'ITEM_SHARE'] as const).map(cat => {
                    const active = category === cat;
                    return (
                      <TouchableOpacity 
                        key={cat}
                        style={[styles.catBtn, active && styles.catBtnActive]}
                        onPress={() => setCategory(cat)}
                      >
                        <Text style={[styles.catBtnText, active && styles.catBtnTextActive]}>{cat.replace('_', ' ')}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Listing Title</Text>
                <TextInput 
                  style={styles.formInput} 
                  placeholder="e.g. Master Bedroom available in Phase 5" 
                  placeholderTextColor={colors.inputPlaceholder}
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Listing Description</Text>
                <TextInput 
                  style={[styles.formInput, {height: 80, paddingVertical: 10}]} 
                  multiline 
                  placeholder="Provide details about the roommate preferences, item condition, or sharing duration..." 
                  placeholderTextColor={colors.inputPlaceholder}
                  value={description}
                  onChangeText={setDescription}
                />
              </View>

              <View style={styles.formGroup}>
                <Text style={styles.formLabel}>Expected Price (Optional)</Text>
                <TextInput 
                  style={styles.formInput} 
                  placeholder="e.g. 15,000/month or 5,000" 
                  placeholderTextColor={colors.inputPlaceholder}
                  value={price}
                  onChangeText={setPrice}
                />
              </View>

              <TouchableOpacity style={styles.submitBtn} onPress={handlePostAd}>
                <Text style={styles.submitBtnText}>Publish Listing</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, marginBottom: 20 },
  logoBox: { backgroundColor: colors.primary, width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  headerSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  addBtn: { backgroundColor: colors.primary, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  tabRow: { flexDirection: 'row', paddingLeft: 20, marginBottom: 16, maxHeight: 40 },
  tabBtn: { backgroundColor: colors.inputBackground, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 10, borderWidth: 1, borderColor: colors.cardBorder },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabBtnText: { color: colors.textMuted, fontSize: 13, fontWeight: 'bold' },
  tabBtnTextActive: { color: '#fff' },

  listings: { flex: 1, paddingHorizontal: 20 },
  adCard: { backgroundColor: colors.inputBackground, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.cardBorder },
  adCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  categoryBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: colors.cardBorder },
  categoryBadgeText: { fontSize: 10, color: colors.textMuted, fontWeight: 'bold', textTransform: 'uppercase' },
  timeText: { fontSize: 11, color: colors.textMuted },
  adTitle: { fontSize: 18, fontWeight: 'bold', color: colors.text, marginBottom: 8 },
  adDesc: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: 14 },
  
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  priceLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  priceValue: { fontSize: 15, color: colors.success, fontWeight: 'bold' },

  posterBox: { backgroundColor: colors.card, borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: colors.cardBorder },
  posterHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  avatarMini: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cardBorder },
  posterName: { fontSize: 13, fontWeight: 'bold', color: colors.text },
  posterDetails: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  
  linkedinBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: 'rgba(0,119,181,0.1)', paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6 },
  linkedinText: { fontSize: 10, color: '#60a5fa', fontWeight: '500' },

  chatBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  chatBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  
  noPostsText: { color: colors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: colors.card, borderTopLeftRadius: 30, borderTopRightRadius: 30, padding: 24, maxHeight: '85%', borderWidth: 1, borderColor: colors.cardBorder },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: colors.text },
  formGroup: { marginBottom: 18 },
  formLabel: { fontSize: 13, color: colors.text, fontWeight: 'bold', marginBottom: 8 },
  formInput: { backgroundColor: colors.inputBackground, borderRadius: 10, height: 46, paddingHorizontal: 12, color: colors.text, borderWidth: 1, borderColor: colors.cardBorder },
  submitBtn: { backgroundColor: colors.success, padding: 16, borderRadius: 12, alignItems: 'center', marginTop: 24, marginBottom: 32 },
  submitBtnText: { color: 'white', fontWeight: 'bold', fontSize: 16 },

  catSelectRow: { flexDirection: 'row', gap: 8 },
  catBtn: { flex: 1, backgroundColor: colors.inputBackground, paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1, borderColor: colors.cardBorder },
  catBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  catBtnText: { fontSize: 11, color: colors.textMuted, fontWeight: 'bold' },
  catBtnTextActive: { color: '#fff' }
});
