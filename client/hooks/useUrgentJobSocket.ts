import { useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useUrgentJob } from '../context/UrgentJobContext';
import { useWebSocket } from './useWebSocket';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import { offlineQueue } from '../utils/offlineQueue';
import type { UrgentJobAssignment } from '../types';

export function useUrgentJobSocket(
  wsAddHandler: ReturnType<typeof useWebSocket>['addHandler'],
) {
  const { setIncomingJob, activeJob, onAcceptHandler, onDeclineHandler } = useUrgentJob();
  const { token } = useAuth();
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const initRef = useRef(false);

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      offlineQueue.init();
    }
  }, []);

  const handleAccept = useCallback(async (jobId: string, startNavigation: boolean) => {
    try {
      await apiRequest('POST', '/api/mobile/jobs/urgent/accept', { jobId, startNavigation }, tokenRef.current);
    } catch {
      offlineQueue.add({ method: 'POST', url: '/api/mobile/jobs/urgent/accept', body: { jobId, startNavigation } });
    }
  }, []);

  const handleDecline = useCallback(async (jobId: string, reason: string) => {
    try {
      await apiRequest('POST', '/api/mobile/jobs/urgent/decline', { jobId, reason }, tokenRef.current);
    } catch {
      offlineQueue.add({ method: 'POST', url: '/api/mobile/jobs/urgent/decline', body: { jobId, reason } });
    }
  }, []);

  useEffect(() => {
    onAcceptHandler.current = handleAccept;
    onDeclineHandler.current = handleDecline;
    return () => {
      onAcceptHandler.current = null;
      onDeclineHandler.current = null;
    };
  }, [handleAccept, handleDecline, onAcceptHandler, onDeclineHandler]);

  useEffect(() => {
    const removeHandler = wsAddHandler((event) => {
      if (event.type === 'job:urgent:assigned') {
        const assignment = event.data as UrgentJobAssignment;
        if (assignment?.job) {
          setIncomingJob(assignment.job);
        }
      }
    });
    return removeHandler;
  }, [wsAddHandler, setIncomingJob]);

  useEffect(() => {
    async function checkActiveUrgentJob() {
      if (activeJob) return;
      try {
        const data = await apiRequest('GET', '/api/mobile/jobs/urgent/active', undefined, tokenRef.current);
        if (data?.activeJob && data.activeJob.status === 'pending') {
          setIncomingJob(data.activeJob);
        }
      } catch {
      }
    }

    checkActiveUrgentJob();

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkActiveUrgentJob();
        offlineQueue.processQueue(tokenRef.current);
      }
    });

    return () => sub.remove();
  }, [activeJob, setIncomingJob]);
}
