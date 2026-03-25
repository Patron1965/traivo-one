import { useEffect, useRef, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, getApiUrl } from '../lib/query-client';
import { useAuth } from '../context/AuthContext';
import type { Order } from '../types';

const MONITOR_INTERVAL = 5 * 60 * 1000;
const DELAY_THRESHOLD = 1.5;
const SLACK_THRESHOLD = 45;
const WORK_DAY_HOURS = 8;

export function useDisruptionMonitor() {
  const { user } = useAuth();
  const triggeredDelays = useRef<Set<string>>(new Set());
  const triggeredEarlyCompletion = useRef(false);

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['/api/mobile/my-orders'],
    enabled: !!user,
  });

  const checkDelays = useCallback(async () => {
    if (!orders || !user) return;
    const now = Date.now();

    for (const order of orders) {
      if (order.status !== 'in_progress' && order.status !== 'on_site') continue;
      if (!order.actualStartTime || !order.estimatedDuration) continue;
      const orderKey = String(order.id);
      if (triggeredDelays.current.has(orderKey)) continue;

      const startMs = new Date(order.actualStartTime).getTime();
      const actualMin = Math.round((now - startMs) / 60000);
      const ratio = actualMin / order.estimatedDuration;

      if (ratio > DELAY_THRESHOLD) {
        triggeredDelays.current.add(orderKey);
        try {
          await apiRequest('POST', '/api/mobile/disruptions/trigger/delay', {
            workOrderId: String(order.id),
            workOrderTitle: order.orderNumber,
            resourceId: String(user.resourceId || user.id),
            resourceName: user.name,
            estimatedDuration: order.estimatedDuration,
            actualDuration: actualMin,
          });
        } catch {}
      }
    }
  }, [orders, user]);

  const checkEarlyCompletion = useCallback(async () => {
    if (!orders || !user || triggeredEarlyCompletion.current) return;

    const activeOrders = orders.filter(o =>
      !['completed', 'utford', 'impossible', 'cancelled', 'failed', 'fakturerad'].includes(o.status)
    );

    if (activeOrders.length > 0) return;

    const completedToday = orders.filter(o =>
      ['completed', 'utford'].includes(o.status) && o.completedAt
    );
    if (completedToday.length === 0) return;

    const lastCompleted = completedToday.reduce((latest, o) => {
      const t = new Date(o.completedAt!).getTime();
      return t > latest ? t : latest;
    }, 0);

    const now = Date.now();
    const today8am = new Date();
    today8am.setHours(8, 0, 0, 0);
    const endOfDay = new Date(today8am.getTime() + WORK_DAY_HOURS * 60 * 60 * 1000);
    const slackMin = Math.round((endOfDay.getTime() - now) / 60000);

    if (slackMin > SLACK_THRESHOLD) {
      triggeredEarlyCompletion.current = true;
      try {
        await apiRequest('POST', '/api/mobile/disruptions/trigger/early-completion', {
          resourceId: String(user.resourceId || user.id),
          resourceName: user.name,
          slackMinutes: slackMin,
        });
      } catch {}
    }
  }, [orders, user]);

  useEffect(() => {
    checkDelays();
    checkEarlyCompletion();

    const interval = setInterval(() => {
      checkDelays();
      checkEarlyCompletion();
    }, MONITOR_INTERVAL);

    return () => clearInterval(interval);
  }, [checkDelays, checkEarlyCompletion]);

  const reportUnavailable = useCallback(async (reason: string) => {
    if (!user) return;
    return apiRequest('POST', '/api/mobile/disruptions/trigger/resource-unavailable', {
      resourceId: String(user.resourceId || user.id),
      resourceName: user.name,
      reason,
    });
  }, [user]);

  return { reportUnavailable };
}
