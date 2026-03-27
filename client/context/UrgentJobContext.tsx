import React, { createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode } from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import type { UrgentJob, UrgentJobStatus } from '../types';

async function showUrgentPushNotification(job: UrgentJob) {
  try {
    const Notifications = await import('expo-notifications');

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('urgent-jobs', {
        name: 'Akuta jobb',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 200, 500],
        enableVibrate: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    }

    await Notifications.setNotificationCategoryAsync('urgent-job-actions', [
      { identifier: 'ACCEPT', buttonTitle: 'Acceptera', options: { opensAppToForeground: true } },
      { identifier: 'DECLINE', buttonTitle: 'Avb\u00F6j', options: { opensAppToForeground: true } },
    ]);

    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'AKUT JOBB TILLDELAT',
        body: `${job.type}: ${job.address}${job.distance ? ` (${job.distance} bort)` : ''}`,
        data: { jobId: job.id, orderId: job.orderId, type: 'urgent_job' },
        priority: Notifications.AndroidNotificationPriority.MAX,
        categoryIdentifier: 'urgent-job-actions',
        ...(Platform.OS === 'android' ? { channelId: 'urgent-jobs' } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.log('[UrgentJob] Push notification skipped:', e);
  }
}

async function showReminderNotification(job: UrgentJob) {
  try {
    const Notifications = await import('expo-notifications');
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'P\u00C5MINNELSE: Akut jobb v\u00E4ntar',
        body: `${job.type}: ${job.address} — svara nu`,
        data: { jobId: job.id, orderId: job.orderId, type: 'urgent_job_reminder' },
        priority: Notifications.AndroidNotificationPriority.MAX,
        ...(Platform.OS === 'android' ? { channelId: 'urgent-jobs' } : {}),
      },
      trigger: null,
    });
  } catch (e) {
    console.log('[UrgentJob] Reminder notification skipped:', e);
  }
}

interface UrgentJobState {
  incomingJob: UrgentJob | null;
  activeJob: UrgentJob | null;
  activeJobStatus: UrgentJobStatus | null;
  pausedOrderId: number | null;
  showDeclineSheet: boolean;
}

interface UrgentJobContextValue extends UrgentJobState {
  setIncomingJob: (job: UrgentJob) => void;
  acceptJob: (startNavigation: boolean) => void;
  declineJob: (reason: string, freetext?: string) => void;
  updateStatus: (status: UrgentJobStatus) => void;
  clearActiveJob: () => void;
  dismissIncoming: () => void;
  openDeclineSheet: () => void;
  closeDeclineSheet: () => void;
  onAcceptHandler: React.MutableRefObject<((jobId: string, startNavigation: boolean) => void) | null>;
  onDeclineHandler: React.MutableRefObject<((jobId: string, reason: string) => void) | null>;
}

const UrgentJobContext = createContext<UrgentJobContextValue | null>(null);

export function UrgentJobProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UrgentJobState>({
    incomingJob: null,
    activeJob: null,
    activeJobStatus: null,
    pausedOrderId: null,
    showDeclineSheet: false,
  });

  const reminderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onAcceptHandler = useRef<((jobId: string, startNavigation: boolean) => void) | null>(null);
  const onDeclineHandler = useRef<((jobId: string, reason: string) => void) | null>(null);

  const clearReminderTimer = useCallback(() => {
    if (reminderTimerRef.current) {
      clearTimeout(reminderTimerRef.current);
      reminderTimerRef.current = null;
    }
  }, []);

  const startReminderTimer = useCallback((job: UrgentJob) => {
    clearReminderTimer();
    reminderTimerRef.current = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      showReminderNotification(job);
    }, 60000);
  }, [clearReminderTimer]);

  const setIncomingJob = useCallback((job: UrgentJob) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    showUrgentPushNotification(job);
    setState(prev => ({ ...prev, incomingJob: job, showDeclineSheet: false }));
    startReminderTimer(job);
  }, [startReminderTimer]);

  const acceptJob = useCallback((startNavigation: boolean) => {
    setState(prev => {
      if (!prev.incomingJob) return prev;
      const job = prev.incomingJob;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (onAcceptHandler.current) {
        onAcceptHandler.current(job.id, startNavigation);
      }
      return {
        ...prev,
        incomingJob: null,
        activeJob: job,
        activeJobStatus: 'accepted',
        showDeclineSheet: false,
      };
    });
    clearReminderTimer();
  }, [clearReminderTimer]);

  const declineJob = useCallback((reason: string, freetext?: string) => {
    setState(prev => {
      if (!prev.incomingJob) return prev;
      const job = prev.incomingJob;
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const fullReason = freetext ? `${reason}: ${freetext}` : reason;
      if (onDeclineHandler.current) {
        onDeclineHandler.current(job.id, fullReason);
      }
      return {
        ...prev,
        incomingJob: null,
        showDeclineSheet: false,
      };
    });
    clearReminderTimer();
  }, [clearReminderTimer]);

  const updateStatus = useCallback((status: UrgentJobStatus) => {
    setState(prev => ({ ...prev, activeJobStatus: status }));
  }, []);

  const clearActiveJob = useCallback(() => {
    setState(prev => ({
      ...prev,
      activeJob: null,
      activeJobStatus: null,
      pausedOrderId: null,
    }));
  }, []);

  const dismissIncoming = useCallback(() => {
    clearReminderTimer();
    setState(prev => ({ ...prev, incomingJob: null, showDeclineSheet: false }));
  }, [clearReminderTimer]);

  const openDeclineSheet = useCallback(() => {
    setState(prev => ({ ...prev, showDeclineSheet: true }));
  }, []);

  const closeDeclineSheet = useCallback(() => {
    setState(prev => ({ ...prev, showDeclineSheet: false }));
  }, []);

  return (
    <UrgentJobContext.Provider value={{
      ...state,
      setIncomingJob,
      acceptJob,
      declineJob,
      updateStatus,
      clearActiveJob,
      dismissIncoming,
      openDeclineSheet,
      closeDeclineSheet,
      onAcceptHandler,
      onDeclineHandler,
    }}>
      {children}
    </UrgentJobContext.Provider>
  );
}

export function useUrgentJob() {
  const ctx = useContext(UrgentJobContext);
  if (!ctx) throw new Error('useUrgentJob must be inside UrgentJobProvider');
  return ctx;
}
