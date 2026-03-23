import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, spacing, fontSize, borderRadius } from '../theme';

const LANGUAGES = [
  { code: 'sv', label: 'Svenska' },
  { code: 'no', label: 'Norsk' },
  { code: 'da', label: 'Dansk' },
  { code: 'fi', label: 'Suomi' },
  { code: 'en', label: 'English' },
];

export function ProfileScreen() {
  const { resource, logout } = useAuth();
  const [selectedLang, setSelectedLang] = useState('sv');

  const handleLogout = () => {
    Alert.alert('Logga ut', 'Är du säker?', [
      { text: 'Avbryt', style: 'cancel' },
      { text: 'Logga ut', onPress: logout, style: 'destructive' },
    ]);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {resource?.initials || resource?.name?.substring(0, 2).toUpperCase() || '??'}
          </Text>
        </View>
        <Text style={styles.name} data-testid="text-profile-name">{resource?.name}</Text>
        <Text style={styles.role}>{resource?.resourceType || 'Chaufför'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Kontaktinfo</Text>
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>E-post</Text>
            <Text style={styles.infoValue} data-testid="text-profile-email">{resource?.email || '-'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Telefon</Text>
            <Text style={styles.infoValue} data-testid="text-profile-phone">{resource?.phone || '-'}</Text>
          </View>
          <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
            <Text style={styles.infoLabel}>Status</Text>
            <View style={[styles.statusBadge, { backgroundColor: resource?.status === 'active' ? colors.auroraGreen + '30' : colors.statusGray + '30' }]}>
              <Text style={[styles.statusBadgeText, { color: resource?.status === 'active' ? colors.auroraGreen : colors.statusGray }]}>
                {resource?.status === 'active' ? 'Aktiv' : resource?.status || '-'}
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Språk</Text>
        <View style={styles.langGrid}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang.code}
              style={[styles.langCard, selectedLang === lang.code && styles.langCardSelected]}
              onPress={() => setSelectedLang(lang.code)}
              data-testid={`button-lang-${lang.code}`}
            >
              <Text style={[styles.langText, selectedLang === lang.code && styles.langTextSelected]}>
                {lang.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
        data-testid="button-logout"
      >
        <Text style={styles.logoutText}>Logga ut</Text>
      </TouchableOpacity>

      <Text style={styles.version}>Traivo Go v1.0.0</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.arcticIce,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
    marginTop: spacing.lg,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.deepOceanBlue,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    color: colors.white,
    fontSize: fontSize.xxl,
    fontWeight: 'bold',
  },
  name: {
    fontSize: fontSize.xl,
    fontWeight: 'bold',
    color: colors.midnightNavy,
  },
  role: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
    marginTop: spacing.xs,
    textTransform: 'capitalize',
  },
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.mountainGray,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    padding: spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    fontSize: fontSize.md,
    color: colors.mountainGray,
  },
  infoValue: {
    fontSize: fontSize.md,
    fontWeight: '500',
    color: colors.midnightNavy,
  },
  statusBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  statusBadgeText: {
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  langGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  langCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  langCardSelected: {
    borderColor: colors.northernTeal,
    backgroundColor: colors.northernTeal + '10',
  },
  langText: {
    fontSize: fontSize.md,
    color: colors.midnightNavy,
  },
  langTextSelected: {
    color: colors.northernTeal,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.error,
    marginBottom: spacing.lg,
  },
  logoutText: {
    color: colors.error,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
  version: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    color: colors.mountainGray,
  },
});
