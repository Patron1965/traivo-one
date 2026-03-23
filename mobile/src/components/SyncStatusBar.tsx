import { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { getPendingCount, syncQueue } from '../services/offlineQueue';
import { colors, spacing, fontSize, borderRadius } from '../theme';
import type { SyncStatus } from '../types';

export function SyncStatusBar() {
  const [pendingCount, setPendingCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('online');
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const check = async () => {
      const count = await getPendingCount();
      setPendingCount(count);
      setSyncStatus(count > 0 ? 'syncing' : 'online');
    };
    check();
    const interval = setInterval(check, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await syncQueue();
      const count = await getPendingCount();
      setPendingCount(count);
      setSyncStatus(count > 0 ? 'syncing' : 'online');
    } catch {
      setSyncStatus('error');
    } finally {
      setIsSyncing(false);
    }
  };

  if (pendingCount === 0 && syncStatus === 'online') return null;

  const statusConfig = {
    online: { bg: colors.auroraGreen + '20', text: colors.auroraGreen, icon: '🟢', label: 'Synkad' },
    syncing: { bg: colors.warning + '20', text: colors.warning, icon: '🟡', label: `${pendingCount} väntar` },
    offline: { bg: colors.statusGray + '20', text: colors.statusGray, icon: '⚪', label: 'Offline' },
    error: { bg: colors.error + '20', text: colors.error, icon: '🔴', label: 'Synkfel' },
  };

  const config = statusConfig[syncStatus];

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: config.bg }]}
      onPress={handleSync}
      disabled={isSyncing}
      data-testid="sync-status-bar"
    >
      <Text style={styles.icon}>{config.icon}</Text>
      <Text style={[styles.text, { color: config.text }]}>
        {isSyncing ? 'Synkar...' : config.label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  icon: {
    fontSize: 12,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: '600',
  },
});
