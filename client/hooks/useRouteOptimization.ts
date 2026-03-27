import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';

type OptimizationStatus = 'idle' | 'submitting' | 'pending' | 'processing' | 'completed' | 'failed';

interface OptimizationState {
  status: OptimizationStatus;
  jobId: string | null;
  progress: number;
  error: string | null;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60;

export function useRouteOptimization() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [state, setState] = useState<OptimizationState>({
    status: 'idle', jobId: null, progress: 0, error: null,
  });
  const pollCountRef = useRef(0);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const submitOptimization = useCallback(async (params: {
    resourceId: string;
    date: string;
    orderIds: string[];
    startLat?: number;
    startLng?: number;
  }) => {
    setState({ status: 'submitting', jobId: null, progress: 0, error: null });
    try {
      const result = await apiRequest('POST', '/api/mobile/optimize-route', params, token);
      const jobId = result.jobId;
      setState({ status: 'pending', jobId, progress: 0, error: null });
      pollCountRef.current = 0;

      pollTimerRef.current = setInterval(async () => {
        pollCountRef.current++;
        if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
          stopPolling();
          setState(prev => ({ ...prev, status: 'failed', error: 'Timeout: optimering tog för lång tid' }));
          return;
        }
        try {
          const statusResult = await apiRequest('GET', `/api/mobile/optimize-route/${jobId}/status`, undefined, token);
          setState(prev => ({
            ...prev,
            status: statusResult.status,
            progress: statusResult.progress || prev.progress,
          }));
          if (statusResult.status === 'completed') {
            stopPolling();
            queryClient.invalidateQueries({ queryKey: ['/api/mobile/my-orders'] });
            queryClient.invalidateQueries({ queryKey: ['/api/mobile/route'] });
          } else if (statusResult.status === 'failed') {
            stopPolling();
            setState(prev => ({ ...prev, error: statusResult.error || 'Optimering misslyckades' }));
          }
        } catch (err: any) {
          console.warn('[optimize] Poll error:', err.message);
        }
      }, POLL_INTERVAL_MS);
    } catch (err: any) {
      setState({ status: 'failed', jobId: null, progress: 0, error: err.message });
    }
  }, [token, queryClient, stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setState({ status: 'idle', jobId: null, progress: 0, error: null });
  }, [stopPolling]);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  return {
    ...state,
    submitOptimization,
    reset,
    isOptimizing: ['submitting', 'pending', 'processing'].includes(state.status),
  };
}
