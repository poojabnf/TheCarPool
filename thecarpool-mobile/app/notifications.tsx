import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, ArrowLeft, CheckCheck, Clock, MapPin, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react-native';
import { c, font, radius, space, shadowSm } from '../theme/tokens';
import { apiFetch } from './services/api';
import { AppCache } from './services/cache';
import * as haptics from './services/haptics';
import HapticPressable from './components/HapticPressable';
import { formatPostedAgo } from './services/datetime';
import { handleNotificationNavigation } from './services/notifications';

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  type?: string;
  ride_id?: string | null;
  booking_id?: string | null;
  read: boolean;
  created_at: string;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    () => AppCache.get<NotificationItem[]>('user_notifications') || []
  );
  const [loading, setLoading] = useState(() => notifications.length === 0);
  const [refreshing, setRefreshing] = useState(false);

  const loadNotifications = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await apiFetch('/api/notifications/mine');
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.notifications) ? data.notifications : [];
        setNotifications(list);
        AppCache.set('user_notifications', list);
      }
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadNotifications();
    }, [loadNotifications])
  );

  const markAllRead = async () => {
    haptics.tap();
    try {
      await apiFetch('/api/notifications/mark-read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      AppCache.set(
        'user_notifications',
        notifications.map((n) => ({ ...n, read: true }))
      );
    } catch {}
  };

  const onNotificationTap = async (item: NotificationItem) => {
    haptics.tap();
    if (!item.read) {
      apiFetch('/api/notifications/mark-read', {
        method: 'POST',
        body: JSON.stringify({ id: item.id }),
      }).catch(() => {});
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, read: true } : n))
      );
    }

    if (item.data) {
      handleNotificationNavigation(item.data);
    } else if (item.ride_id) {
      router.push(/trip/);
    } else if (item.booking_id) {
      router.push('/(tabs)/trips');
    }
  };

  const getIcon = (type?: string) => {
    switch (type) {
      case 'BOOKING_REQUESTED':
        return <Clock color="#EAB308" size={20} strokeWidth={2.4} />;
      case 'BOOKING_CONFIRMED':
        return <CheckCircle2 color={c.go} size={20} strokeWidth={2.4} />;
      case 'RIDER_REQUEST_DECLINED':
      case 'BOOKING_CANCELLED':
        return <XCircle color={c.danger} size={20} strokeWidth={2.4} />;
      case 'BOARDING_SOON':
        return <MapPin color={c.accent} size={20} strokeWidth={2.4} />;
      default:
        return <Bell color={c.brand} size={20} strokeWidth={2.4} />;
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Top Header */}
      <View style={styles.header}>
        <HapticPressable style={styles.backBtn} onPress={() => router.back()}>
          <ArrowLeft color={c.textPrimary} size={22} strokeWidth={2.2} />
        </HapticPressable>
        <Text style={styles.title}>Notification Center</Text>
        {notifications.some((n) => !n.read) ? (
          <HapticPressable style={styles.markReadBtn} onPress={markAllRead}>
            <CheckCheck color={c.brand} size={18} strokeWidth={2.2} />
            <Text style={styles.markReadText}>Read All</Text>
          </HapticPressable>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      {loading && notifications.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.brand} size="large" />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.center}>
          <View style={styles.emptyIconBg}>
            <Bell color={c.textDisabled} size={36} strokeWidth={1.8} />
          </View>
          <Text style={styles.emptyTitle}>No Notifications Yet</Text>
          <Text style={styles.emptySub}>
            All your booking updates, driver requests, OTPs, and ride alerts will appear here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadNotifications(true)}
              tintColor={c.brand}
            />
          }
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <HapticPressable
              style={[styles.itemCard, !item.read && styles.unreadCard]}
              onPress={() => onNotificationTap(item)}
              activeOpacity={0.7}
            >
              <View style={styles.itemIconContainer}>{getIcon(item.type)}</View>
              <View style={styles.itemBody}>
                <View style={styles.itemHeaderRow}>
                  <Text style={[styles.itemTitle, !item.read && styles.unreadTitle]}>
                    {item.title}
                  </Text>
                  {!item.read && <View style={styles.unreadDot} />}
                </View>
                <Text style={styles.itemText}>{item.body}</Text>
                <Text style={styles.itemTime}>
                  {item.created_at ? formatPostedAgo(item.created_at) : 'Just now'}
                </Text>
              </View>
            </HapticPressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.bgBase,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: c.borderSubtle,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 18,
    fontFamily: font.sansBold,
    color: c.textPrimary,
  },
  markReadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  markReadText: {
    fontSize: 13,
    fontFamily: font.sansSemibold,
    color: c.brand,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  emptyIconBg: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: c.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.lg,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: font.sansBold,
    color: c.textPrimary,
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 14,
    fontFamily: font.sans,
    color: c.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  listContent: {
    padding: space.lg,
    gap: space.md,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: space.lg,
    backgroundColor: c.bgSurface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.borderSubtle,
    gap: space.md,
    ...shadowSm,
  },
  unreadCard: {
    backgroundColor: c.bgElevated,
    borderColor: c.brand,
    borderLeftWidth: 4,
  },
  itemIconContainer: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: c.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemBody: {
    flex: 1,
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  itemTitle: {
    fontSize: 15,
    fontFamily: font.sansSemibold,
    color: c.textPrimary,
    flex: 1,
  },
  unreadTitle: {
    fontFamily: font.sansBold,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: c.brand,
    marginLeft: 6,
  },
  itemText: {
    fontSize: 13,
    fontFamily: font.sans,
    color: c.textSecondary,
    lineHeight: 18,
    marginBottom: 6,
  },
  itemTime: {
    fontSize: 11,
    fontFamily: font.sans,
    color: c.textDisabled,
  },
});
