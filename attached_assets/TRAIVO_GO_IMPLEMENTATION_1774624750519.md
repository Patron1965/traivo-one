# 🚀 Traivo Go – Implementation Guide

> **Projekt:** Traivo Go (React Native fältarbetarapp)
> **Mål:** Implementera ny navigation (3 tabs + hamburger-meny) och integrera med backend
> **Senast uppdaterad:** 2026-03-27
> **Estimerad total tid:** ~8–10 timmar

---

## ⚡ Quick Start

```bash
# 1. Öppna Traivo Go-projektet i Replit
# 2. Kopiera denna fil till projektets rot
# 3. Om du redan har navigation-branchen: Börja på Fas 2
# 4. Om inte: Börja på Fas 1 (merge navigation branch)
```

**Redan klara filer** (om navigation-branchen är mergead):
- ✅ `client/navigation/TabNavigator.tsx` – 3 tabs
- ✅ `client/navigation/RootNavigator.tsx` – Stack screens uppdaterade
- ✅ `client/components/HamburgerMenu.tsx` – Sidopanel-meny

**Kvar att göra:**
1. 🔄 Merga navigation-branch (om ej gjort)
2. 🔗 Integrera med nya backend-endpoints
3. 📱 UI/UX-förbättringar (haptics, animationer, badges)
4. 🧪 Testa allt end-to-end

---

## 📋 Checklista – Översikt

### Fas 1: Merga Navigation Branch (⏱️ ~30min)
- [ ] 1.1 Verifiera att navigations-filerna finns
- [ ] 1.2 Om inte: Skapa/kopiera de tre ändrade filerna
- [ ] 1.3 Verifiera att appen startar korrekt
- [ ] 1.4 Testa grundläggande navigation

### Fas 2: Notifikations-integration (⏱️ ~2h)
- [ ] 2.1 Skapa `useNotifications` hook
- [ ] 2.2 Uppdatera HamburgerMenu med badge
- [ ] 2.3 Skapa NotificationsScreen-förbättringar
- [ ] 2.4 Lägg till WebSocket-lyssnare
- [ ] 2.5 Testa notifikationer

### Fas 3: Användarpreferenser (⏱️ ~1.5h)
- [ ] 3.1 Skapa `usePreferences` hook
- [ ] 3.2 Integrera preferenser i HamburgerMenu
- [ ] 3.3 Uppdatera SettingsScreen
- [ ] 3.4 Testa preferenser

### Fas 4: UI/UX-förbättringar (⏱️ ~2h)
- [ ] 4.1 Haptic feedback på tab-tryck och meny
- [ ] 4.2 Animerad sidopanel (slide-in istället för fade)
- [ ] 4.3 Swipe-to-close för hamburger-meny
- [ ] 4.4 Statistik-preview widget i menyn
- [ ] 4.5 Pull-to-refresh på NotificationsScreen
- [ ] 4.6 Testa UX-förbättringar

### Fas 5: App Config Integration (⏱️ ~1h)
- [ ] 5.1 Skapa `useAppConfig` hook
- [ ] 5.2 Server-driven navigation
- [ ] 5.3 Version check vid appstart
- [ ] 5.4 Testa config-integration

### Fas 6: Offline-stöd (⏱️ ~1.5h)
- [ ] 6.1 Cacha notifikationer offline
- [ ] 6.2 Cacha preferenser offline
- [ ] 6.3 Queue-system för offline-ändringar
- [ ] 6.4 Testa offline-flöde

### Fas 7: End-to-End Tester (⏱️ ~1h)
- [ ] 7.1 Navigationsflöde-test
- [ ] 7.2 Hamburger-meny test
- [ ] 7.3 Backend-integration test
- [ ] 7.4 Regressionstest (befintliga flöden)

---

## 🔧 Fas 1: Merga Navigation Branch

### 1.1 Kontrollera om filerna redan finns

```bash
# Kör i Replit Shell:
echo "=== Kollar navigationsfiler ==="
cat client/navigation/TabNavigator.tsx | head -5
echo "---"
ls -la client/components/HamburgerMenu.tsx 2>/dev/null && echo "HamburgerMenu finns!" || echo "HamburgerMenu SAKNAS"
```

### 1.2 Om filerna saknas – kopiera in dem

#### TabNavigator.tsx (ersätt hela filen)

```typescript
// client/navigation/TabNavigator.tsx
import React from 'react';
import { StyleSheet, View, Platform, Image } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Feather } from '@expo/vector-icons';
import { HomeScreen } from '../screens/HomeScreen';
import { OrdersScreen } from '../screens/OrdersScreen';
import { MapScreen } from '../screens/MapScreen';
import { ScreenErrorBoundary } from '../components/ScreenErrorBoundary';
import { HamburgerMenuButton } from '../components/HamburgerMenu';
import { Colors, FontSize, Spacing, BorderRadius } from '../constants/theme';

const Tab = createBottomTabNavigator();

function HeaderTitle() {
  return (
    <Image
      source={require('../../assets/traivo-logo.png')}
      style={{ width: 120, height: 32 }}
      resizeMode="contain"
    />
  );
}

function TabIcon({ name, color, focused }: { name: string; color: string; focused: boolean }) {
  return (
    <View style={[styles.tabIconWrap, focused ? styles.tabIconWrapActive : null]}>
      <Feather name={name as any} size={24} color={color} />
    </View>
  );
}

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: Colors.surface },
        headerTintColor: Colors.text,
        headerTitleStyle: { fontFamily: 'Inter_600SemiBold' },
        headerShadowVisible: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
        headerRight: () => <HamburgerMenuButton />,
        headerRightContainerStyle: { paddingRight: Spacing.md },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeScreen}
        options={{
          headerTitle: () => <HeaderTitle />,
          tabBarLabel: 'Hem',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="home" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="OrdersTab"
        component={OrdersScreen}
        options={{
          headerTitle: 'Uppdrag',
          tabBarLabel: 'Uppdrag',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="clipboard" color={color} focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="MapTab"
        options={{
          headerTitle: 'Karta',
          tabBarLabel: 'Karta',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon name="map" color={color} focused={focused} />
          ),
        }}
      >
        {(props: any) => (
          <ScreenErrorBoundary fallbackTitle="Kartan kunde inte visas" fallbackIcon="map">
            <MapScreen {...props} />
          </ScreenErrorBoundary>
        )}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.surface,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    height: Platform.OS === 'ios' ? 92 : 72,
    paddingBottom: Platform.OS === 'ios' ? 28 : 10,
    paddingTop: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  tabBarItem: {
    paddingTop: 4,
    gap: 2,
  },
  tabBarLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: FontSize.md,
    marginTop: 2,
  },
  tabIconWrap: {
    width: 52,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: BorderRadius.round,
  },
  tabIconWrapActive: {
    backgroundColor: Colors.infoLight,
  },
});
```

#### HamburgerMenu.tsx (ny fil)

> ⚠️ Denna fil är lång (~300 rader). Se den fullständiga koden i `client/components/HamburgerMenu.tsx` i navigation-branchen, eller kopiera från den medföljande filen `HamburgerMenu.tsx`.

Kärnan:
- `HamburgerMenuButton` – triggerknapp i headern
- `HamburgerMenuModal` – sidopanel med alla menyval
- Användarprofil, online-toggle, logga ut med bekräftelse

#### RootNavigator.tsx (uppdatera)

Lägg till dessa stack screens (efter befintliga):

```typescript
// Lägg till bland imports:
import { AIAssistantScreen } from '../screens/AIAssistantScreen';
import { ProfileScreen } from '../screens/ProfileScreen';

// Lägg till i <Stack.Navigator> (bland andra screens):
<Stack.Screen
  name="AIAssistant"
  options={{
    headerTitle: 'Traivo Assist',
    headerStyle: { backgroundColor: Colors.surface },
    headerShadowVisible: true,
  }}
>
  {(props: any) => (
    <ScreenErrorBoundary fallbackTitle="Assistenten kunde inte visas" fallbackIcon="cpu">
      <AIAssistantScreen {...props} />
    </ScreenErrorBoundary>
  )}
</Stack.Screen>
<Stack.Screen
  name="Profile"
  component={ProfileScreen}
  options={{ headerTitle: 'Profil' }}
/>
```

### 1.3 Verifiera att appen startar

```bash
# I Replit Shell:
npm start
# eller
npx expo start
```

**Förväntat resultat:**
- Bottom bar visar 3 tabs: Hem, Uppdrag, Karta
- Hamburger-ikon (☰) visas i header-högra hörnet
- Trycka på ☰ öppnar sidopanel

### 🧪 Testa Fas 1 – Checklista

- [ ] App startar utan errors
- [ ] 3 tabs visas (inte 5)
- [ ] Hamburger-knapp visas i header
- [ ] Hamburger-meny öppnas med alla menyval
- [ ] "AI-Assistent" navigerar till rätt skärm
- [ ] "Logga ut" visar bekräftelsedialog
- [ ] Alla befintliga navigationslänkar fungerar (OrderDetail, etc.)

---

## 🔧 Fas 2: Notifikations-integration

### 2.1 Skapa useNotifications hook

**Fil:** `client/hooks/useNotifications.ts` (ny fil)

```typescript
// client/hooks/useNotifications.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import { useWebSocket } from './useWebSocket';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = '@notifications_cache';
const COUNT_CACHE_KEY = '@notifications_unread_count';

export interface Notification {
  id: string;
  type: 'order_assigned' | 'order_updated' | 'deviation_response' | 
        'team_invite' | 'schedule_change' | 'system' | 'reminder';
  title: string;
  body: string;
  data?: Record<string, any>;
  read: boolean;
  createdAt: string;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

export function useNotifications(): UseNotificationsReturn {
  const { authToken } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ws = useWebSocket();

  // Ladda cachade notifikationer vid mount
  useEffect(() => {
    loadCached();
  }, []);

  // Hämta från API
  useEffect(() => {
    if (authToken) {
      fetchNotifications();
      fetchUnreadCount();
    }
  }, [authToken]);

  // WebSocket-lyssnare
  useEffect(() => {
    if (!ws) return;

    const handleNewNotification = (notification: Notification) => {
      setNotifications(prev => [notification, ...prev]);
      setUnreadCount(prev => prev + 1);
    };

    const handleUnreadUpdate = (data: { unreadCount: number }) => {
      setUnreadCount(data.unreadCount);
    };

    ws.on('new_notification', handleNewNotification);
    ws.on('unread_count_update', handleUnreadUpdate);

    return () => {
      ws.off('new_notification', handleNewNotification);
      ws.off('unread_count_update', handleUnreadUpdate);
    };
  }, [ws]);

  async function loadCached() {
    try {
      const [cached, cachedCount] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY),
        AsyncStorage.getItem(COUNT_CACHE_KEY),
      ]);
      if (cached) setNotifications(JSON.parse(cached));
      if (cachedCount) setUnreadCount(parseInt(cachedCount, 10));
    } catch (e) {
      console.log('Failed to load cached notifications:', e);
    }
  }

  async function fetchNotifications() {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiRequest('GET', '/api/notifications?limit=50', undefined, authToken);
      if (data.success) {
        setNotifications(data.notifications);
        await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data.notifications));
      }
    } catch (e: any) {
      setError(e.message);
      console.error('Failed to fetch notifications:', e);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchUnreadCount() {
    try {
      const data = await apiRequest('GET', '/api/notifications/unread-count', undefined, authToken);
      if (data.success) {
        setUnreadCount(data.unreadCount);
        await AsyncStorage.setItem(COUNT_CACHE_KEY, String(data.unreadCount));
      }
    } catch (e) {
      console.error('Failed to fetch unread count:', e);
    }
  }

  const refresh = useCallback(async () => {
    await Promise.all([fetchNotifications(), fetchUnreadCount()]);
  }, [authToken]);

  const markAsRead = useCallback(async (id: string) => {
    try {
      await apiRequest('POST', `/api/notifications/${id}/read`, {}, authToken);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (e) {
      console.error('Failed to mark notification as read:', e);
    }
  }, [authToken]);

  const markAllAsRead = useCallback(async () => {
    try {
      await apiRequest('POST', '/api/notifications/read-all', {}, authToken);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error('Failed to mark all as read:', e);
    }
  }, [authToken]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refresh,
    markAsRead,
    markAllAsRead,
  };
}

// -----------------------------------------------------------
// Lightweight hook – bara antal olästa (för badge i meny)
// -----------------------------------------------------------
export function useUnreadCount(): number {
  const { unreadCount } = useNotifications();
  return unreadCount;
}
```

### 2.2 Uppdatera HamburgerMenu med notifikations-badge

**Fil:** `client/components/HamburgerMenu.tsx` (modifiera)

Lägg till i `HamburgerMenuModal`-komponenten:

```typescript
// Lägg till import högst upp:
import { useUnreadCount } from '../hooks/useNotifications';

// I HamburgerMenuModal, lägg till:
function HamburgerMenuModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  // ... befintlig kod ...
  const unreadCount = useUnreadCount(); // <-- LÄGG TILL

  // Uppdatera notifications-item i menuItems:
  const menuItems: MenuItem[] = [
    // ... 
    {
      id: 'notifications',
      label: 'Aviseringar',
      icon: 'bell',
      screen: 'Notifications',
      color: '#2196F3',
      bgColor: '#E3F2FD',
      badge: unreadCount, // <-- LÄGG TILL
    },
    // ...
  ];

  // I renderingen av menyitems, visa badge:
  // (Uppdatera menuItem-renderingen)
  return (
    // ... I menuItems.map((item) => ...) :
    <Pressable key={item.id} style={/* ... */}>
      <View style={[styles.menuIcon, { backgroundColor: item.bgColor }]}>
        <Feather name={item.icon} size={18} color={item.color} />
      </View>
      <ThemedText variant="body" style={styles.menuLabel}>
        {item.label}
      </ThemedText>
      {/* BADGE – LÄGG TILL: */}
      {item.badge && item.badge > 0 ? (
        <View style={styles.badgeContainer}>
          <ThemedText variant="caption" color="#fff" style={styles.badgeText}>
            {item.badge > 99 ? '99+' : item.badge}
          </ThemedText>
        </View>
      ) : (
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      )}
    </Pressable>
  );
}

// Lägg till styles:
const additionalStyles = StyleSheet.create({
  badgeContainer: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    lineHeight: 14,
  },
});
```

### 2.3 Uppdatera HamburgerMenuButton med badge-dot

```typescript
// I HamburgerMenuButton – visa en röd prick om det finns olästa:
export function HamburgerMenuButton() {
  const [visible, setVisible] = useState(false);
  const unreadCount = useUnreadCount(); // <-- LÄGG TILL

  return (
    <>
      <Pressable
        onPress={() => setVisible(true)}
        hitSlop={12}
        style={styles.menuButton}
        testID="button-hamburger-menu"
      >
        <Feather name="menu" size={24} color={Colors.text} />
        {/* Notifikations-indikator */}
        {unreadCount > 0 && (
          <View style={styles.menuBadgeDot} />
        )}
      </Pressable>
      <HamburgerMenuModal visible={visible} onClose={() => setVisible(false)} />
    </>
  );
}

// Style:
const styles = StyleSheet.create({
  // ... befintliga ...
  menuBadgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#EF4444',
    borderWidth: 1.5,
    borderColor: Colors.surface,
  },
});
```

### 🧪 Testa Fas 2

- [ ] Röd prick visas på hamburger-ikonen vid olästa notiser
- [ ] Badge-nummer visas bredvid "Aviseringar" i menyn
- [ ] Trycka på "Aviseringar" öppnar NotificationsScreen
- [ ] Markera som läst minskar badge-numret
- [ ] "Markera alla som lästa" sätter badge till 0

---

## 🔧 Fas 3: Användarpreferenser

### 3.1 Skapa usePreferences hook

**Fil:** `client/hooks/usePreferences.ts` (ny fil)

```typescript
// client/hooks/usePreferences.ts
import { useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFS_CACHE_KEY = '@user_preferences';

export interface UserPreferences {
  menuOrder?: string[];
  favoriteScreens?: string[];
  pushEnabled?: boolean;
  pushCategories?: {
    orderAssigned?: boolean;
    scheduleChange?: boolean;
    teamUpdates?: boolean;
    deviationResponse?: boolean;
    systemMessages?: boolean;
  };
  darkMode?: boolean;
  fontSize?: 'small' | 'medium' | 'large';
  hapticFeedback?: boolean;
  mapType?: 'standard' | 'satellite' | 'hybrid';
  showTraffic?: boolean;
  autoNavigate?: boolean;
  autoStartSession?: boolean;
  breakReminders?: boolean;
  breakIntervalMinutes?: number;
}

interface UsePreferencesReturn {
  preferences: UserPreferences;
  isLoading: boolean;
  updatePreference: <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => Promise<void>;
  updatePreferences: (updates: Partial<UserPreferences>) => Promise<void>;
  refresh: () => Promise<void>;
}

const DEFAULT_PREFS: UserPreferences = {
  pushEnabled: true,
  darkMode: false,
  fontSize: 'medium',
  hapticFeedback: true,
  mapType: 'standard',
  showTraffic: true,
  autoNavigate: false,
  breakReminders: true,
  breakIntervalMinutes: 120,
};

export function usePreferences(): UsePreferencesReturn {
  const { authToken } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadCachedPreferences();
    if (authToken) fetchPreferences();
  }, [authToken]);

  async function loadCachedPreferences() {
    try {
      const cached = await AsyncStorage.getItem(PREFS_CACHE_KEY);
      if (cached) {
        setPreferences({ ...DEFAULT_PREFS, ...JSON.parse(cached) });
      }
    } catch (e) {
      console.log('Failed to load cached preferences:', e);
    }
  }

  async function fetchPreferences() {
    try {
      setIsLoading(true);
      const data = await apiRequest('GET', '/api/user/preferences', undefined, authToken);
      if (data.success) {
        const prefs = { ...DEFAULT_PREFS, ...data.preferences };
        setPreferences(prefs);
        await AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
      }
    } catch (e) {
      console.error('Failed to fetch preferences:', e);
    } finally {
      setIsLoading(false);
    }
  }

  const updatePreference = useCallback(async <K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    // Optimistic update
    setPreferences(prev => {
      const updated = { ...prev, [key]: value };
      AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });

    try {
      await apiRequest('PATCH', '/api/user/preferences', { [key]: value }, authToken);
    } catch (e) {
      console.error('Failed to update preference:', e);
      // Rollback on failure
      await fetchPreferences();
    }
  }, [authToken]);

  const updatePreferences = useCallback(async (updates: Partial<UserPreferences>) => {
    setPreferences(prev => {
      const updated = { ...prev, ...updates };
      AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });

    try {
      await apiRequest('PATCH', '/api/user/preferences', updates, authToken);
    } catch (e) {
      console.error('Failed to update preferences:', e);
      await fetchPreferences();
    }
  }, [authToken]);

  const refresh = useCallback(async () => {
    await fetchPreferences();
  }, [authToken]);

  return { preferences, isLoading, updatePreference, updatePreferences, refresh };
}
```

### 3.2 Integrera i HamburgerMenu

```typescript
// I HamburgerMenuModal, använd preferenser för meny-ordning:
import { usePreferences } from '../hooks/usePreferences';

function HamburgerMenuModal({ visible, onClose }: Props) {
  const { preferences } = usePreferences();
  
  // Sortera menyitems baserat på användarens sparade ordning
  const sortedItems = useMemo(() => {
    if (!preferences.menuOrder) return menuItems;
    
    const orderMap = new Map(preferences.menuOrder.map((id, i) => [id, i]));
    return [...menuItems].sort((a, b) => {
      if (a.separator || b.separator) return 0;
      const aOrder = orderMap.get(a.id) ?? 999;
      const bOrder = orderMap.get(b.id) ?? 999;
      return aOrder - bOrder;
    });
  }, [preferences.menuOrder, menuItems]);

  // Rendera sortedItems istället för menuItems
}
```

### 3.3 Skapa förbättrad SettingsScreen

**Fil:** `client/screens/SettingsScreen.tsx` (modifiera)

```typescript
// Lägg till preferens-kopplingar i SettingsScreen:
import { usePreferences } from '../hooks/usePreferences';

export function SettingsScreen() {
  const { preferences, updatePreference, isLoading } = usePreferences();

  return (
    <ScrollView style={styles.container}>
      {/* Utseende */}
      <View style={styles.section}>
        <ThemedText variant="label" style={styles.sectionTitle}>
          Utseende
        </ThemedText>
        
        <SettingsRow
          icon="moon"
          label="Mörkt läge"
          value={preferences.darkMode}
          onToggle={(v) => updatePreference('darkMode', v)}
        />
        
        <SettingsPicker
          icon="type"
          label="Textstorlek"
          value={preferences.fontSize || 'medium'}
          options={[
            { label: 'Liten', value: 'small' },
            { label: 'Medium', value: 'medium' },
            { label: 'Stor', value: 'large' },
          ]}
          onChange={(v) => updatePreference('fontSize', v as any)}
        />
      </View>

      {/* Notifikationer */}
      <View style={styles.section}>
        <ThemedText variant="label" style={styles.sectionTitle}>
          Notifikationer
        </ThemedText>
        
        <SettingsRow
          icon="bell"
          label="Push-notifikationer"
          value={preferences.pushEnabled}
          onToggle={(v) => updatePreference('pushEnabled', v)}
        />
        
        {preferences.pushEnabled && (
          <>
            <SettingsRow
              icon="clipboard"
              label="Nya uppdrag"
              value={preferences.pushCategories?.orderAssigned}
              onToggle={(v) => updatePreference('pushCategories', {
                ...preferences.pushCategories,
                orderAssigned: v,
              })}
              indent
            />
            <SettingsRow
              icon="calendar"
              label="Schemaändringar"
              value={preferences.pushCategories?.scheduleChange}
              onToggle={(v) => updatePreference('pushCategories', {
                ...preferences.pushCategories,
                scheduleChange: v,
              })}
              indent
            />
            <SettingsRow
              icon="users"
              label="Team-uppdateringar"
              value={preferences.pushCategories?.teamUpdates}
              onToggle={(v) => updatePreference('pushCategories', {
                ...preferences.pushCategories,
                teamUpdates: v,
              })}
              indent
            />
          </>
        )}
      </View>

      {/* Karta */}
      <View style={styles.section}>
        <ThemedText variant="label" style={styles.sectionTitle}>
          Karta
        </ThemedText>
        
        <SettingsPicker
          icon="map"
          label="Karttyp"
          value={preferences.mapType || 'standard'}
          options={[
            { label: 'Standard', value: 'standard' },
            { label: 'Satellit', value: 'satellite' },
            { label: 'Hybrid', value: 'hybrid' },
          ]}
          onChange={(v) => updatePreference('mapType', v as any)}
        />
        
        <SettingsRow
          icon="navigation"
          label="Visa trafik"
          value={preferences.showTraffic}
          onToggle={(v) => updatePreference('showTraffic', v)}
        />
      </View>

      {/* Arbetspass */}
      <View style={styles.section}>
        <ThemedText variant="label" style={styles.sectionTitle}>
          Arbetspass
        </ThemedText>
        
        <SettingsRow
          icon="smartphone"
          label="Haptisk feedback"
          value={preferences.hapticFeedback}
          onToggle={(v) => updatePreference('hapticFeedback', v)}
        />
        
        <SettingsRow
          icon="coffee"
          label="Rastpåminnelser"
          value={preferences.breakReminders}
          onToggle={(v) => updatePreference('breakReminders', v)}
        />
      </View>
    </ScrollView>
  );
}

// -----------------------------------------------------------
// Helper-komponenter
// -----------------------------------------------------------
function SettingsRow({ icon, label, value, onToggle, indent }: {
  icon: string;
  label: string;
  value?: boolean;
  onToggle: (value: boolean) => void;
  indent?: boolean;
}) {
  return (
    <View style={[styles.settingsRow, indent && styles.settingsRowIndent]}>
      <Feather name={icon as any} size={20} color={Colors.textSecondary} />
      <ThemedText variant="body" style={styles.settingsLabel}>{label}</ThemedText>
      <Switch
        value={value ?? false}
        onValueChange={onToggle}
        trackColor={{ false: Colors.border, true: Colors.primaryLight }}
        thumbColor={value ? Colors.primary : '#f4f3f4'}
      />
    </View>
  );
}
```

### 🧪 Testa Fas 3

- [ ] Preferenser laddas vid appstart
- [ ] Ändra "Haptisk feedback" → sparas till backend
- [ ] Stäng och öppna appen → inställningen bevaras
- [ ] Offline: ändring sparas lokalt, synkas vid anslutning
- [ ] SettingsScreen visar korrekta toggle-states

---

## 🔧 Fas 4: UI/UX-förbättringar

### 4.1 Haptic Feedback

**Fil:** `client/utils/haptics.ts` (ny fil)

```typescript
// client/utils/haptics.ts
import { Platform } from 'react-native';

let Haptics: any = null;

// Lazy-load expo-haptics (fungerar i Expo, noop i web)
async function loadHaptics() {
  if (Haptics !== null) return;
  try {
    Haptics = await import('expo-haptics');
  } catch {
    Haptics = false; // Markera som ej tillgänglig
  }
}

export async function hapticLight() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}

export async function hapticMedium() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
}

export async function hapticSuccess() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }
}

export async function hapticWarning() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }
}

export async function hapticSelection() {
  await loadHaptics();
  if (Haptics && Platform.OS !== 'web') {
    Haptics.selectionAsync();
  }
}
```

**Integrera i TabNavigator:**

```typescript
// I TabNavigator – lägg till haptics på tab-tryck:
import { hapticLight } from '../utils/haptics';

// I Tab.Navigator screenOptions:
tabBarButton: (props) => (
  <Pressable
    {...props}
    onPress={(e) => {
      hapticLight();
      props.onPress?.(e);
    }}
  />
),
```

**Integrera i HamburgerMenu:**

```typescript
// I HamburgerMenuButton:
import { hapticLight, hapticSelection } from '../utils/haptics';

<Pressable
  onPress={() => {
    hapticLight(); // <-- LÄGG TILL
    setVisible(true);
  }}
>

// I meny-items:
<Pressable
  onPress={() => {
    hapticSelection(); // <-- LÄGG TILL
    if (item.screen) navigateTo(item.screen);
  }}
>
```

### 4.2 Animerad sidopanel (slide-in)

Ersätt `animationType="fade"` med en Animated-baserad slide:

```typescript
// I HamburgerMenuModal – ersätt Modal med Animated:
import { Animated, Easing } from 'react-native';

function HamburgerMenuModal({ visible, onClose }: Props) {
  const slideAnim = useRef(new Animated.Value(-PANEL_WIDTH)).current;
  const overlayAnim = useRef(new Animated.Value(0)).current;
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    if (visible) {
      setIsRendered(true);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 1,
          duration: 280,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -PANEL_WIDTH,
          duration: 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(overlayAnim, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start(() => setIsRendered(false));
    }
  }, [visible]);

  if (!isRendered) return null;

  return (
    <Modal transparent visible={isRendered} statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Animated overlay */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: 'rgba(0,0,0,0.45)', opacity: overlayAnim },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        {/* Animated panel */}
        <Animated.View
          style={[
            styles.menuPanel,
            { transform: [{ translateX: slideAnim }] },
          ]}
        >
          {/* ... menyn som förut ... */}
        </Animated.View>
      </View>
    </Modal>
  );
}
```

### 4.3 Swipe-to-close

```typescript
// Lägg till i HamburgerMenuModal:
import { PanResponder } from 'react-native';

const panResponder = useRef(
  PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gestureState) => {
      // Aktivera swipe bara om användaren drar åt vänster
      return gestureState.dx < -10 && Math.abs(gestureState.dy) < 30;
    },
    onPanResponderMove: (_, gestureState) => {
      if (gestureState.dx < 0) {
        slideAnim.setValue(gestureState.dx);
      }
    },
    onPanResponderRelease: (_, gestureState) => {
      if (gestureState.dx < -80 || gestureState.vx < -0.5) {
        // Stäng menyn
        onClose();
      } else {
        // Studsa tillbaka
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      }
    },
  })
).current;

// Applicera på panelen:
<Animated.View
  {...panResponder.panHandlers}
  style={[styles.menuPanel, { transform: [{ translateX: slideAnim }] }]}
>
```

### 4.4 Statistik-preview i menyn

```typescript
// Skapa en liten statistik-widget som visas i hamburger-menyn:

function QuickStatsWidget() {
  const [stats, setStats] = useState<any>(null);
  const { authToken } = useAuth();

  useEffect(() => {
    fetchQuickStats();
  }, []);

  async function fetchQuickStats() {
    try {
      const data = await apiRequest(
        'GET', '/api/mobile/statistics/summary', undefined, authToken
      );
      if (data.success) setStats(data.summary);
    } catch (e) { /* silent */ }
  }

  if (!stats) return null;

  return (
    <View style={quickStyles.container}>
      <View style={quickStyles.statRow}>
        <View style={quickStyles.stat}>
          <ThemedText variant="heading" color={Colors.primary}>
            {stats.today.completedOrders}/{stats.today.totalOrders}
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>
            Klara idag
          </ThemedText>
        </View>
        <View style={quickStyles.stat}>
          <ThemedText variant="heading" color={Colors.success}>
            {stats.today.hoursWorked}h
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>
            Arbetat
          </ThemedText>
        </View>
        <View style={quickStyles.stat}>
          <ThemedText variant="heading" color={Colors.info}>
            {stats.today.kilometers}
          </ThemedText>
          <ThemedText variant="caption" color={Colors.textSecondary}>
            km kört
          </ThemedText>
        </View>
      </View>
    </View>
  );
}

const quickStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.background,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  stat: {
    alignItems: 'center',
  },
});

// Placera i HamburgerMenuModal, mellan user-header och meny-items:
// <QuickStatsWidget />
```

### 🧪 Testa Fas 4

- [ ] Haptic feedback känns på iOS/Android vid tab-tryck
- [ ] Hamburger-meny glider in från vänster (inte bara fade)
- [ ] Swipe vänster stänger menyn
- [ ] Statistik-widget visar dagens data i menyn
- [ ] Allt fungerar smidigt utan lag

---

## 🔧 Fas 5: App Config Integration

### 5.1 Skapa useAppConfig hook

**Fil:** `client/hooks/useAppConfig.ts` (ny fil)

```typescript
// client/hooks/useAppConfig.ts
import { useState, useEffect } from 'react';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking, Platform } from 'react-native';

const CONFIG_CACHE_KEY = '@app_config';
const APP_VERSION = '1.2.0'; // Uppdatera vid release

interface AppConfig {
  features: {
    hamburgerMenu: boolean;
    aiAssistant: boolean;
    teamFeature: boolean;
    offlineMode: boolean;
    darkMode: boolean;
    haptics: boolean;
  };
  navigation?: any;
}

export function useAppConfig() {
  const { authToken } = useAuth();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadConfig();
    checkVersion();
  }, [authToken]);

  async function loadConfig() {
    try {
      // Ladda cachad config först
      const cached = await AsyncStorage.getItem(CONFIG_CACHE_KEY);
      if (cached) setConfig(JSON.parse(cached));

      // Hämta färsk config
      const data = await apiRequest('GET', '/api/app/config', undefined, authToken);
      if (data.success) {
        setConfig(data.config);
        await AsyncStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(data.config));
      }
    } catch (e) {
      console.log('Failed to load app config:', e);
    } finally {
      setIsLoading(false);
    }
  }

  async function checkVersion() {
    try {
      const data = await apiRequest(
        'GET',
        `/api/app/version-check?currentVersion=${APP_VERSION}`,
        undefined,
        authToken
      );
      if (data.success && data.forceUpdate) {
        Alert.alert(
          'Uppdatering krävs',
          'En ny version av Traivo Go finns tillgänglig. Du måste uppdatera för att fortsätta.',
          [
            {
              text: 'Uppdatera',
              onPress: () => {
                const url = Platform.OS === 'ios'
                  ? data.updateUrl.ios
                  : data.updateUrl.android;
                Linking.openURL(url);
              },
            },
          ],
          { cancelable: false }
        );
      } else if (data.success && data.needsUpdate) {
        // Mjuk påminnelse (visa 1 gång per dag)
        const lastReminder = await AsyncStorage.getItem('@update_reminder');
        const today = new Date().toDateString();
        if (lastReminder !== today) {
          Alert.alert(
            'Ny version tillgänglig',
            `Version ${data.latestVersion} finns nu. Vill du uppdatera?`,
            [
              { text: 'Senare', style: 'cancel' },
              {
                text: 'Uppdatera',
                onPress: () => {
                  const url = Platform.OS === 'ios'
                    ? data.updateUrl.ios
                    : data.updateUrl.android;
                  Linking.openURL(url);
                },
              },
            ]
          );
          await AsyncStorage.setItem('@update_reminder', today);
        }
      }
    } catch (e) {
      // Tyst misslyckande – version check är inte kritisk
    }
  }

  function isFeatureEnabled(feature: keyof AppConfig['features']): boolean {
    return config?.features?.[feature] ?? true; // Default: aktiverad
  }

  return { config, isLoading, isFeatureEnabled };
}
```

### 🧪 Testa Fas 5

- [ ] App hämtar config vid start
- [ ] Feature flags fungerar (dölja/visa menyalternativ)
- [ ] Version check visar alert vid gammal version
- [ ] Config cachas offline

---

## 🔧 Fas 6: Offline-stöd

### 6.1 Offline Queue

**Fil:** `client/utils/offlineQueue.ts` (ny fil)

```typescript
// client/utils/offlineQueue.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { apiRequest } from '../lib/query-client';

const QUEUE_KEY = '@offline_queue';

interface QueuedAction {
  id: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: any;
  createdAt: string;
  retries: number;
}

class OfflineQueue {
  private queue: QueuedAction[] = [];
  private processing = false;

  async init() {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (stored) this.queue = JSON.parse(stored);
    } catch (e) {
      console.log('Failed to load offline queue:', e);
    }

    // Lyssna på nätverksändringar
    NetInfo.addEventListener(state => {
      if (state.isConnected && this.queue.length > 0) {
        this.processQueue();
      }
    });
  }

  async add(action: Omit<QueuedAction, 'id' | 'createdAt' | 'retries'>) {
    const item: QueuedAction = {
      ...action,
      id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      createdAt: new Date().toISOString(),
      retries: 0,
    };
    this.queue.push(item);
    await this.save();
  }

  async processQueue(authToken?: string | null) {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      this.processing = false;
      return;
    }

    const toProcess = [...this.queue];
    const failed: QueuedAction[] = [];

    for (const action of toProcess) {
      try {
        await apiRequest(action.method, action.url, action.body, authToken);
        console.log(`[OfflineQueue] Processed: ${action.method} ${action.url}`);
      } catch (e) {
        action.retries += 1;
        if (action.retries < 5) {
          failed.push(action);
        } else {
          console.warn(`[OfflineQueue] Dropped after 5 retries: ${action.url}`);
        }
      }
    }

    this.queue = failed;
    await this.save();
    this.processing = false;
  }

  private async save() {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
  }

  get pendingCount(): number {
    return this.queue.length;
  }
}

export const offlineQueue = new OfflineQueue();
```

### Integrera med preferenser

```typescript
// I usePreferences hook – lägg till offline-stöd:
import { offlineQueue } from '../utils/offlineQueue';
import NetInfo from '@react-native-community/netinfo';

const updatePreference = useCallback(async (key, value) => {
  // Optimistic update (alltid)
  setPreferences(prev => ({ ...prev, [key]: value }));
  
  const netState = await NetInfo.fetch();
  if (netState.isConnected) {
    try {
      await apiRequest('PATCH', '/api/user/preferences', { [key]: value }, authToken);
    } catch (e) {
      // Om API-anrop misslyckas, queue:a
      await offlineQueue.add({
        method: 'PATCH',
        url: '/api/user/preferences',
        body: { [key]: value },
      });
    }
  } else {
    // Offline – queue:a direkt
    await offlineQueue.add({
      method: 'PATCH',
      url: '/api/user/preferences',
      body: { [key]: value },
    });
  }
}, [authToken]);
```

### 🧪 Testa Fas 6

- [ ] Stäng av WiFi → ändra en inställning → inställningen sparas lokalt
- [ ] Slå på WiFi → ändringen synkas automatiskt till backend
- [ ] Notifikationer visas från cache när offline
- [ ] Offline-queue töms vid återanslutning

---

## 🧪 Fas 7: End-to-End Test

### 7.1 Navigationsflöde

```
Testfall: Komplett fältarbetarflöde
1. Öppna appen → Hem-tab visas med 3 tabs
2. Tryck Uppdrag-tab → Orderlista visas
3. Tryck på en order → OrderDetail visas
4. Tryck tillbaka → Tillbaka till Uppdrag
5. Tryck Karta-tab → Karta visas
6. Tryck ☰ → Hamburger-meny öppnar
7. Tryck "AI-Assistent" → AIAssistant öppnar
8. Tryck tillbaka → Tillbaka till senaste tab
9. Tryck ☰ → Tryck "Inställningar" → Settings öppnar
10. Ändra en inställning → Sparas
11. Tryck ☰ → Tryck "Logga ut" → Bekräftelse visas
12. Bekräfta → Tillbaka till login
```

### 7.2 Hamburger-meny test

```
Testfall: Alla menyalternativ
□ AI-Assistent → AIAssistantScreen öppnar
□ Aviseringar → NotificationsScreen öppnar, badge försvinner vid läsning
□ Mitt team → TeamScreen öppnar
□ Statistik → StatisticsScreen öppnar
□ Kundrapporter → CustomerReportsScreen öppnar
□ Mina avvikelser → MyDeviationsScreen öppnar
□ Ruttbetyg → RouteFeedbackScreen öppnar
□ Inställningar → SettingsScreen öppnar
□ Om Traivo Go → Info visas
□ Logga ut → Bekräftelsedialog → Login
```

### 7.3 Regressionstest

```
Testfall: Befintliga funktioner fungerar fortfarande
□ Login med telefonnummer → Fungerar
□ Se dagens ordrar på Hem → Fungerar
□ Filtrera ordrar → Fungerar
□ Starta/slutföra order → Fungerar
□ Ta foto → Fungerar
□ Rapportera avvikelse → Fungerar
□ Logga material → Fungerar
□ Kundsignatur → Fungerar
□ GPS-navigering → Fungerar
□ Offline-mode → Fungerar
□ Push-notifikationer → Fungerar
□ WebSocket-uppdateringar → Fungerar
```

---

## 📁 Nya och ändrade filer – sammanfattning

| Fil | Typ | Fas | Beskrivning |
|-----|-----|-----|-------------|
| `client/navigation/TabNavigator.tsx` | **Modifierad** | 1 | 5→3 tabs, hamburger i header |
| `client/navigation/RootNavigator.tsx` | **Modifierad** | 1 | AI + Profil som stack screens |
| `client/components/HamburgerMenu.tsx` | **Ny** | 1 | Sidopanel-meny med alla funktioner |
| `client/hooks/useNotifications.ts` | **Ny** | 2 | Hook för notifikationer + oläst antal |
| `client/hooks/usePreferences.ts` | **Ny** | 3 | Hook för användarinställningar |
| `client/hooks/useAppConfig.ts` | **Ny** | 5 | Hook för app-konfiguration + version check |
| `client/utils/haptics.ts` | **Ny** | 4 | Haptisk feedback-helpers |
| `client/utils/offlineQueue.ts` | **Ny** | 6 | Offline-kö för API-anrop |
| `client/screens/SettingsScreen.tsx` | **Modifierad** | 3 | Preferens-kopplingar |

---

## 🎯 Acceptanskriterier – Fullständig lista

### Grundläggande navigation
- [ ] 3 bottom tabs visas (Hem, Uppdrag, Karta)
- [ ] Hamburger-ikon (☰) visas i header på alla tabs
- [ ] Sidopanel öppnas vid tryck på ☰
- [ ] Alla 11 menyalternativ fungerar
- [ ] Logga ut kräver bekräftelse
- [ ] Touch targets ≥ 44pt (iOS HIG)

### Notifikationer
- [ ] Röd prick på ☰ vid olästa notiser
- [ ] Badge-nummer i menyn
- [ ] Realtidsuppdatering via WebSocket
- [ ] Markera som läst fungerar
- [ ] Fungerar offline (visar cachade)

### Preferenser
- [ ] Inställningar sparas till backend
- [ ] Optimistic updates (ingen väntetid)
- [ ] Offline-sparning + synk vid anslutning

### UI/UX
- [ ] Haptisk feedback vid tab-tryck
- [ ] Smooth slide-in animation för meny
- [ ] Swipe-to-close fungerar
- [ ] Statistik-preview i menyn
- [ ] Ingen visuell regression

### Bakåtkompatibilitet
- [ ] Alla befintliga 22 skärmar fungerar
- [ ] Inga broken navigation-links
- [ ] Push-notifikationer fungerar fortfarande
- [ ] Offline-mode fungerar fortfarande

---

## ⏱️ Tidplan

| Fas | Uppgift | Estimerad tid | Beroende av |
|-----|---------|---------------|-------------|
| 1 | Merga navigation | 30 min | — |
| 2 | Notifikationer | 2h | Fas 1 + Backend Fas 1 |
| 3 | Preferenser | 1.5h | Fas 1 + Backend Fas 2 |
| 4 | UI/UX-förbättringar | 2h | Fas 1 |
| 5 | App Config | 1h | Backend Fas 3 |
| 6 | Offline-stöd | 1.5h | Fas 2 + 3 |
| 7 | E2E-tester | 1h | Alla |
| | **Totalt** | **~9.5h** | |

> 💡 **Tips:** Fas 1 och 4 kan göras utan backend-ändringar. Börja där!

---

> 🔗 **Relaterat dokument:** Se `TRAIVO_ONE_IMPLEMENTATION.md` för backend-endpoints som dessa hooks anropar.
