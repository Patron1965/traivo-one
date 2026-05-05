import { useQuery } from "@tanstack/react-query";

export type SyncStatus = "fresh" | "stale" | "pending" | "empty";

export interface JobExpandPeriod {
  desiredDeliveryStart: string | null;
  desiredDeliveryEnd: string | null;
  plannedWindowStart: string | null;
  plannedWindowEnd: string | null;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  slaDeadlineAt: string | null;
  slaRiskLevel: string | null;
  createdAt: string | null;
}

export interface JobExpandHistoryItem {
  id: string;
  title: string;
  scheduledDate: string | null;
  orderStatus: string;
  executionStatus: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface JobExpandCommunication {
  id: string;
  channel: string;
  notificationType: string;
  status: string;
  subject: string | null;
  message: string;
  sentAt: string | null;
  createdAt: string;
}

export interface JobExpandImage {
  id: string;
  url: string;
  label: string;
  date: string;
}

export interface JobExpandNotes {
  notes: string | null;
  plannedNotes: string | null;
  description: string | null;
}

export interface JobExpandMaterial {
  id: string;
  articleId: string | null;
  articleName: string | null;
  articleNumber: string | null;
  quantity: number;
  resolvedPrice: number | null;
  notes: string | null;
}

export interface JobExpandCounts {
  period: number;
  history: number;
  communications: number;
  images: number;
  notes: number;
  materials: number;
}

export interface JobExpandSyncEntry {
  status: SyncStatus;
  latestSyncAt: string | null;
}

export interface JobExpandSync {
  pendingFieldSync: boolean;
  period: JobExpandSyncEntry;
  history: JobExpandSyncEntry;
  communications: JobExpandSyncEntry;
  images: JobExpandSyncEntry;
  notes: JobExpandSyncEntry;
  materials: JobExpandSyncEntry;
}

export interface JobExpandData {
  period: JobExpandPeriod;
  history: JobExpandHistoryItem[];
  communications: JobExpandCommunication[];
  images: JobExpandImage[];
  notes: JobExpandNotes;
  materials: JobExpandMaterial[];
  counts: JobExpandCounts;
  sync: JobExpandSync;
}

export function useJobExpandData(jobId: string | null, enabled: boolean) {
  return useQuery<JobExpandData>({
    queryKey: ["/api/work-orders", jobId, "expand"],
    enabled: enabled && !!jobId,
    staleTime: 60_000,
  });
}
