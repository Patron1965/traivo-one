import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

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
  slaDaysToBreach: number | null;
  slaPredictedCompletionDate: string | null;
  slaReason: string | null;
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
  isOptional?: boolean;
  isCompleted?: boolean;
  completedAt?: string | null;
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

function expandKey(jobId: string) {
  return ["/api/work-orders", jobId, "expand"] as const;
}

function recomputeNotesCount(notes: JobExpandNotes): number {
  return [notes.notes, notes.plannedNotes, notes.description].filter(Boolean).length;
}

function recomputePeriodCount(period: JobExpandPeriod): number {
  return (
    period.desiredDeliveryStart ||
    period.desiredDeliveryEnd ||
    period.plannedWindowStart ||
    period.plannedWindowEnd ||
    period.scheduledDate ||
    period.scheduledStartTime ||
    period.slaDeadlineAt
  )
    ? 1
    : 0;
}

export interface UpdateNotesInput {
  notes?: string | null;
  plannedNotes?: string | null;
}

export function useUpdateJobNotes(jobId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdateNotesInput, { previous?: JobExpandData }>({
    mutationFn: async (input) => {
      const payload: Record<string, unknown> = {};
      if (input.notes !== undefined) payload.notes = input.notes ?? null;
      if (input.plannedNotes !== undefined) payload.plannedNotes = input.plannedNotes ?? null;
      await apiRequest("PATCH", `/api/work-orders/${jobId}`, payload);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: expandKey(jobId) });
      const previous = qc.getQueryData<JobExpandData>(expandKey(jobId));
      if (previous) {
        const nextNotes: JobExpandNotes = {
          ...previous.notes,
          ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
          ...(input.plannedNotes !== undefined ? { plannedNotes: input.plannedNotes ?? null } : {}),
        };
        qc.setQueryData<JobExpandData>(expandKey(jobId), {
          ...previous,
          notes: nextNotes,
          counts: { ...previous.counts, notes: recomputeNotesCount(nextNotes) },
        });
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(expandKey(jobId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: expandKey(jobId) });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });
}

export interface UpdatePeriodInput {
  desiredDeliveryStart?: string | null;
  desiredDeliveryEnd?: string | null;
}

export function useUpdateJobPeriod(jobId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdatePeriodInput, { previous?: JobExpandData }>({
    mutationFn: async (input) => {
      const payload: Record<string, unknown> = {};
      if (input.desiredDeliveryStart !== undefined) {
        payload.desiredDeliveryStart = input.desiredDeliveryStart ?? null;
      }
      if (input.desiredDeliveryEnd !== undefined) {
        payload.desiredDeliveryEnd = input.desiredDeliveryEnd ?? null;
      }
      await apiRequest("PATCH", `/api/work-orders/${jobId}`, payload);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: expandKey(jobId) });
      const previous = qc.getQueryData<JobExpandData>(expandKey(jobId));
      if (previous) {
        const nextPeriod: JobExpandPeriod = {
          ...previous.period,
          ...(input.desiredDeliveryStart !== undefined
            ? { desiredDeliveryStart: input.desiredDeliveryStart ?? null }
            : {}),
          ...(input.desiredDeliveryEnd !== undefined
            ? { desiredDeliveryEnd: input.desiredDeliveryEnd ?? null }
            : {}),
        };
        qc.setQueryData<JobExpandData>(expandKey(jobId), {
          ...previous,
          period: nextPeriod,
          counts: { ...previous.counts, period: recomputePeriodCount(nextPeriod) },
        });
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(expandKey(jobId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: expandKey(jobId) });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });
}

export interface UpdateLineInput {
  lineId: string;
  quantity?: number;
  isOptional?: boolean;
  isCompleted?: boolean;
  resolvedPrice?: number | null;
  notes?: string | null;
}

export function useUpdateJobLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, UpdateLineInput, { previous?: JobExpandData }>({
    mutationFn: async (input) => {
      const payload: Record<string, unknown> = {};
      if (input.quantity !== undefined) payload.quantity = input.quantity;
      if (input.isOptional !== undefined) payload.isOptional = input.isOptional;
      if (input.isCompleted !== undefined) payload.isCompleted = input.isCompleted;
      if (input.resolvedPrice !== undefined) payload.resolvedPrice = input.resolvedPrice;
      if (input.notes !== undefined) payload.notes = input.notes;
      await apiRequest("PATCH", `/api/work-order-lines/${input.lineId}`, payload);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: expandKey(jobId) });
      const previous = qc.getQueryData<JobExpandData>(expandKey(jobId));
      if (previous) {
        const nextMaterials = previous.materials.map((m) =>
          m.id === input.lineId
            ? {
                ...m,
                ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
                ...(input.isOptional !== undefined ? { isOptional: input.isOptional } : {}),
                ...(input.isCompleted !== undefined
                  ? {
                      isCompleted: input.isCompleted,
                      completedAt: input.isCompleted ? (m.completedAt ?? new Date().toISOString()) : null,
                    }
                  : {}),
                ...(input.resolvedPrice !== undefined ? { resolvedPrice: input.resolvedPrice } : {}),
                ...(input.notes !== undefined ? { notes: input.notes } : {}),
              }
            : m,
        );
        qc.setQueryData<JobExpandData>(expandKey(jobId), {
          ...previous,
          materials: nextMaterials,
        });
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(expandKey(jobId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: expandKey(jobId) });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });
}

export interface CreateLineInput {
  articleId: string;
  articleName?: string | null;
  articleNumber?: string | null;
  quantity: number;
}

export function useCreateJobLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, CreateLineInput, { previous?: JobExpandData; tempId: string }>({
    mutationFn: async (input) => {
      await apiRequest("POST", `/api/work-orders/${jobId}/lines`, {
        articleId: input.articleId,
        quantity: input.quantity,
      });
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: expandKey(jobId) });
      const previous = qc.getQueryData<JobExpandData>(expandKey(jobId));
      const tempId = `tmp-${Date.now()}`;
      if (previous) {
        const optimisticLine: JobExpandMaterial = {
          id: tempId,
          articleId: input.articleId,
          articleName: input.articleName ?? null,
          articleNumber: input.articleNumber ?? null,
          quantity: input.quantity,
          resolvedPrice: null,
          notes: null,
          isOptional: false,
        };
        const nextMaterials = [...previous.materials, optimisticLine];
        qc.setQueryData<JobExpandData>(expandKey(jobId), {
          ...previous,
          materials: nextMaterials,
          counts: { ...previous.counts, materials: nextMaterials.length },
        });
      }
      return { previous, tempId };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(expandKey(jobId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: expandKey(jobId) });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });
}

export interface DeleteLineInput {
  lineId: string;
}

export function useDeleteJobLine(jobId: string) {
  const qc = useQueryClient();
  return useMutation<void, Error, DeleteLineInput, { previous?: JobExpandData }>({
    mutationFn: async (input) => {
      await apiRequest("DELETE", `/api/work-order-lines/${input.lineId}`);
    },
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: expandKey(jobId) });
      const previous = qc.getQueryData<JobExpandData>(expandKey(jobId));
      if (previous) {
        const nextMaterials = previous.materials.filter((m) => m.id !== input.lineId);
        qc.setQueryData<JobExpandData>(expandKey(jobId), {
          ...previous,
          materials: nextMaterials,
          counts: { ...previous.counts, materials: nextMaterials.length },
        });
      }
      return { previous };
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(expandKey(jobId), ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: expandKey(jobId) });
      queryClient.invalidateQueries({ queryKey: ["/api/work-orders"] });
    },
  });
}
