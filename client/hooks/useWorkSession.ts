import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';

export interface WorkSession {
  id: string;
  resourceId: number | string;
  teamId?: string | null;
  status: 'active' | 'paused' | 'completed';
  startedAt: string;
  pausedAt?: string | null;
  endedAt?: string | null;
  notes?: string;
  totalWorkMinutes: number;
  totalBreakMinutes: number;
}

export interface WorkSessionEntry {
  entryType: 'work' | 'travel' | 'setup' | 'break' | 'rest';
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  workOrderId?: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
}

export function useWorkSession() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: sessionData, isLoading } = useQuery({
    queryKey: ['/api/mobile/work-sessions/active'],
    enabled: !!token,
    refetchInterval: 60000,
  });

  const session: WorkSession | null = sessionData?.session || null;

  useEffect(() => {
    if (session?.status === 'active' && session.startedAt) {
      const updateElapsed = () => {
        const start = new Date(session.startedAt).getTime();
        setElapsed(Math.floor((Date.now() - start) / 1000));
      };
      updateElapsed();
      timerRef.current = setInterval(updateElapsed, 1000);
      return () => { if (timerRef.current) clearInterval(timerRef.current); };
    } else {
      setElapsed(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }, [session?.status, session?.startedAt]);

  const startMutation = useMutation({
    mutationFn: (params?: { teamId?: string; notes?: string }) =>
      apiRequest('POST', '/api/mobile/work-sessions/start', params || {}, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mobile/work-sessions/active'] }),
  });

  const stopMutation = useMutation({
    mutationFn: () => {
      if (!session?.id) throw new Error('Inget aktivt pass');
      return apiRequest('POST', `/api/mobile/work-sessions/${session.id}/stop`, {}, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mobile/work-sessions/active'] }),
  });

  const pauseMutation = useMutation({
    mutationFn: () => {
      if (!session?.id) throw new Error('Inget aktivt pass');
      return apiRequest('POST', `/api/mobile/work-sessions/${session.id}/pause`, {}, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mobile/work-sessions/active'] }),
  });

  const resumeMutation = useMutation({
    mutationFn: () => {
      if (!session?.id) throw new Error('Inget aktivt pass');
      return apiRequest('POST', `/api/mobile/work-sessions/${session.id}/resume`, {}, token);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mobile/work-sessions/active'] }),
  });

  const logEntryMutation = useMutation({
    mutationFn: (entry: WorkSessionEntry) => {
      if (!session?.id) throw new Error('Inget aktivt pass');
      return apiRequest('POST', `/api/mobile/work-sessions/${session.id}/entries`, entry, token);
    },
  });

  const formatElapsed = useCallback(() => {
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  }, [elapsed]);

  return {
    session,
    isLoading,
    elapsed,
    formatElapsed,
    isActive: session?.status === 'active',
    isPaused: session?.status === 'paused',
    startSession: startMutation.mutateAsync,
    stopSession: stopMutation.mutateAsync,
    pauseSession: pauseMutation.mutateAsync,
    resumeSession: resumeMutation.mutateAsync,
    logEntry: logEntryMutation.mutateAsync,
    isStarting: startMutation.isPending,
    isStopping: stopMutation.isPending,
    isPausing: pauseMutation.isPending,
    isResuming: resumeMutation.isPending,
  };
}
