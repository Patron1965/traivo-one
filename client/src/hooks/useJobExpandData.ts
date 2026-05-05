import { useQuery } from "@tanstack/react-query";

export interface JobExpandPeriod {
  desiredDeliveryStart: string | null;
  desiredDeliveryEnd: string | null;
  plannedWindowStart: string | null;
  plannedWindowEnd: string | null;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
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

export interface JobExpandObjectImage {
  id: string;
  imageUrl: string;
  description: string | null;
  imageDate: string;
}

export interface JobExpandProtocolImage {
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

export interface JobExpandData {
  period: JobExpandPeriod;
  history: JobExpandHistoryItem[];
  communications: JobExpandCommunication[];
  images: { object: JobExpandObjectImage[]; protocols: JobExpandProtocolImage[] };
  notes: JobExpandNotes;
  materials: JobExpandMaterial[];
  counts: JobExpandCounts;
}

export function useJobExpandData(jobId: string | null, enabled: boolean) {
  return useQuery<JobExpandData>({
    queryKey: ["/api/work-orders", jobId, "expand"],
    enabled: enabled && !!jobId,
    staleTime: 60_000,
  });
}
