import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ViewMode } from "./types";

export type PopoutView = "calendar" | "orderlager";
export type SyncRole = "main" | "popout-calendar" | "popout-orderlager";

export interface SyncedFilters {
  customer: string;
  priority: string;
  cluster: string;
  team: string;
  executionCode: string;
  search: string;
}

export interface AssignSlot {
  resourceId: string;
  resourceName: string;
  date: string;
  startTime: string | null;
}

export interface SyncedState {
  weekStart: string;
  currentDate: string;
  viewMode: ViewMode;
  selectedJob: string | null;
  filters: SyncedFilters;
}

type SyncMessage =
  | { type: "state"; senderId: string; senderRole: SyncRole; state: SyncedState; timestamp: number }
  | { type: "popout-mounted"; senderId: string; view: PopoutView; timestamp: number }
  | { type: "popout-closed"; senderId: string; view: PopoutView; timestamp: number }
  | { type: "popout-heartbeat"; senderId: string; view: PopoutView; timestamp: number }
  | { type: "request-state"; senderId: string; timestamp: number }
  | { type: "slot-changed"; senderId: string; senderRole: SyncRole; slot: AssignSlot | null; timestamp: number };

interface UsePlannerSyncOpts {
  role: SyncRole;
  state: SyncedState;
  applyRemoteState: (s: SyncedState) => void;
  onPopoutsChange?: (views: Set<PopoutView>) => void;
  selectedSlot: AssignSlot | null;
  onRemoteSlotChange?: (slot: AssignSlot | null) => void;
  disabled?: boolean;
}

const CHANNEL_NAME = "traivo-planner";
const STORAGE_KEY = "traivo-planner-msg";
const HEARTBEAT_MS = 500;
const HEARTBEAT_TIMEOUT = 1500;

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function usePlannerSync(opts: UsePlannerSyncOpts) {
  const senderIdRef = useRef<string>(makeId());
  const channelRef = useRef<BroadcastChannel | null>(null);
  const ignoreUntilRef = useRef<number>(0);
  const lastSentStateKeyRef = useRef<string>("");
  const lastSentSlotKeyRef = useRef<string>("");
  const popoutLastSeenRef = useRef<Map<PopoutView, number>>(new Map());

  const stateRef = useRef(opts.state);
  stateRef.current = opts.state;
  const applyRef = useRef(opts.applyRemoteState);
  applyRef.current = opts.applyRemoteState;
  const onPopoutsChangeRef = useRef(opts.onPopoutsChange);
  onPopoutsChangeRef.current = opts.onPopoutsChange;
  const onRemoteSlotChangeRef = useRef(opts.onRemoteSlotChange);
  onRemoteSlotChangeRef.current = opts.onRemoteSlotChange;
  const roleRef = useRef(opts.role);
  roleRef.current = opts.role;

  const post = useCallback((msg: SyncMessage) => {
    try {
      if (channelRef.current) {
        channelRef.current.postMessage(msg);
        return;
      }
    } catch {}
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(msg));
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  useEffect(() => {
    if (opts.disabled) return;

    let ch: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        ch = new BroadcastChannel(CHANNEL_NAME);
        channelRef.current = ch;
      }
    } catch {}

    const handleMessage = (msg: SyncMessage) => {
      if (!msg || typeof msg !== "object" || !("type" in msg)) return;
      const senderId = (msg as { senderId?: string }).senderId;
      if (senderId === senderIdRef.current) return;

      switch (msg.type) {
        case "state": {
          ignoreUntilRef.current = Date.now() + 250;
          lastSentStateKeyRef.current = JSON.stringify(msg.state);
          applyRef.current(msg.state);
          break;
        }
        case "popout-mounted":
        case "popout-heartbeat": {
          if (roleRef.current !== "main") return;
          const wasNew = !popoutLastSeenRef.current.has(msg.view);
          popoutLastSeenRef.current.set(msg.view, Date.now());
          if (wasNew) {
            onPopoutsChangeRef.current?.(new Set(popoutLastSeenRef.current.keys()));
          }
          if (msg.type === "popout-mounted") {
            post({
              type: "state",
              senderId: senderIdRef.current,
              senderRole: roleRef.current,
              state: stateRef.current,
              timestamp: Date.now(),
            });
          }
          break;
        }
        case "popout-closed": {
          if (roleRef.current !== "main") return;
          if (popoutLastSeenRef.current.has(msg.view)) {
            popoutLastSeenRef.current.delete(msg.view);
            onPopoutsChangeRef.current?.(new Set(popoutLastSeenRef.current.keys()));
          }
          break;
        }
        case "request-state": {
          if (roleRef.current !== "main") return;
          post({
            type: "state",
            senderId: senderIdRef.current,
            senderRole: roleRef.current,
            state: stateRef.current,
            timestamp: Date.now(),
          });
          break;
        }
        case "slot-changed": {
          if (msg.senderRole === "popout-orderlager") return;
          onRemoteSlotChangeRef.current?.(msg.slot);
          break;
        }
      }
    };

    const onChannelMessage = (e: MessageEvent<SyncMessage>) => handleMessage(e.data);
    if (ch) ch.addEventListener("message", onChannelMessage);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        handleMessage(JSON.parse(e.newValue) as SyncMessage);
      } catch {}
    };
    window.addEventListener("storage", onStorage);

    let heartbeatTimer: number | null = null;
    let expirationTimer: number | null = null;

    if (roleRef.current !== "main") {
      const view: PopoutView = roleRef.current === "popout-calendar" ? "calendar" : "orderlager";
      post({ type: "popout-mounted", senderId: senderIdRef.current, view, timestamp: Date.now() });
      post({ type: "request-state", senderId: senderIdRef.current, timestamp: Date.now() });
      heartbeatTimer = window.setInterval(() => {
        post({ type: "popout-heartbeat", senderId: senderIdRef.current, view, timestamp: Date.now() });
      }, HEARTBEAT_MS);
    } else {
      expirationTimer = window.setInterval(() => {
        const now = Date.now();
        let changed = false;
        for (const [view, ts] of Array.from(popoutLastSeenRef.current.entries())) {
          if (now - ts >= HEARTBEAT_TIMEOUT) {
            popoutLastSeenRef.current.delete(view);
            changed = true;
          }
        }
        if (changed) onPopoutsChangeRef.current?.(new Set(popoutLastSeenRef.current.keys()));
      }, HEARTBEAT_MS);
    }

    const onUnload = () => {
      if (roleRef.current !== "main") {
        const view: PopoutView = roleRef.current === "popout-calendar" ? "calendar" : "orderlager";
        post({ type: "popout-closed", senderId: senderIdRef.current, view, timestamp: Date.now() });
      }
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);

    return () => {
      if (ch) {
        ch.removeEventListener("message", onChannelMessage);
        try { ch.close(); } catch {}
      }
      channelRef.current = null;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (expirationTimer) clearInterval(expirationTimer);
    };
  }, [opts.disabled, post]);

  const stateKey = useMemo(() => JSON.stringify(opts.state), [opts.state]);
  useEffect(() => {
    if (opts.disabled) return;
    if (Date.now() < ignoreUntilRef.current) {
      lastSentStateKeyRef.current = stateKey;
      return;
    }
    if (stateKey === lastSentStateKeyRef.current) return;
    lastSentStateKeyRef.current = stateKey;
    post({
      type: "state",
      senderId: senderIdRef.current,
      senderRole: opts.role,
      state: opts.state,
      timestamp: Date.now(),
    });
  }, [stateKey, opts.disabled, opts.role, post, opts.state]);

  const slotKey = useMemo(() => JSON.stringify(opts.selectedSlot), [opts.selectedSlot]);
  useEffect(() => {
    if (opts.disabled) return;
    if (opts.role === "popout-orderlager") return;
    if (slotKey === lastSentSlotKeyRef.current) return;
    lastSentSlotKeyRef.current = slotKey;
    post({
      type: "slot-changed",
      senderId: senderIdRef.current,
      senderRole: opts.role,
      slot: opts.selectedSlot,
      timestamp: Date.now(),
    });
  }, [slotKey, opts.disabled, opts.role, post, opts.selectedSlot]);
}

export function openPlannerPopout(view: PopoutView): Window | null {
  const url = `/planering/popout?view=${view}`;
  const name = `traivo-planner-${view}`;
  const w = window.open(url, name, "width=1400,height=900,menubar=no,toolbar=no,location=no,status=no");
  if (w) {
    try { w.focus(); } catch {}
  }
  return w;
}
