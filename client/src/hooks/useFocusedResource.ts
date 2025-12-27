import { useState, useEffect, useCallback, useRef } from "react";

const CHANNEL_NAME = "unicorn-resource-focus";
const STORAGE_KEY = "unicorn-focused-resource";

interface FocusedResourceState {
  resourceId: string | null;
  resourceName: string | null;
  windowId: string | null;
}

interface AssignJobMessage {
  type: "assign-job";
  jobId: string;
  resourceId: string;
  date: string;
}

interface FocusResourceMessage {
  type: "focus-resource";
  resourceId: string;
  resourceName: string;
  windowId: string;
}

interface UnfocusResourceMessage {
  type: "unfocus-resource";
  windowId: string;
}

interface JobAssignedMessage {
  type: "job-assigned";
  jobId: string;
  resourceId: string;
  success: boolean;
}

type ChannelMessage = AssignJobMessage | FocusResourceMessage | UnfocusResourceMessage | JobAssignedMessage;

export function useFocusedResource() {
  const [focusedResource, setFocusedResource] = useState<FocusedResourceState>({
    resourceId: null,
    resourceName: null,
    windowId: null,
  });
  const channelRef = useRef<BroadcastChannel | null>(null);
  const windowId = useRef<string>(Math.random().toString(36).substring(7));

  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      channelRef.current = new BroadcastChannel(CHANNEL_NAME);
      
      channelRef.current.onmessage = (event: MessageEvent<ChannelMessage>) => {
        const message = event.data;
        
        if (message.type === "focus-resource") {
          const newState = {
            resourceId: message.resourceId,
            resourceName: message.resourceName,
            windowId: message.windowId,
          };
          setFocusedResource(newState);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newState));
        } else if (message.type === "unfocus-resource") {
          setFocusedResource(prev => {
            if (prev.windowId === message.windowId) {
              localStorage.removeItem(STORAGE_KEY);
              return { resourceId: null, resourceName: null, windowId: null };
            }
            return prev;
          });
        } else if (message.type === "job-assigned") {
          console.log("Job assigned event received:", message.jobId, message.resourceId, message.success);
        }
      };
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setFocusedResource(parsed);
      } catch (e) {
        console.error("Failed to parse stored focused resource:", e);
      }
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        if (e.newValue) {
          try {
            setFocusedResource(JSON.parse(e.newValue));
          } catch (err) {
            console.error("Failed to parse storage event:", err);
          }
        } else {
          setFocusedResource({ resourceId: null, resourceName: null, windowId: null });
        }
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      channelRef.current?.close();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const focusResource = useCallback((resourceId: string, resourceName: string) => {
    const message: FocusResourceMessage = {
      type: "focus-resource",
      resourceId,
      resourceName,
      windowId: windowId.current,
    };
    
    channelRef.current?.postMessage(message);
    setFocusedResource({
      resourceId,
      resourceName,
      windowId: windowId.current,
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      resourceId,
      resourceName,
      windowId: windowId.current,
    }));
  }, []);

  const unfocusResource = useCallback(() => {
    const message: UnfocusResourceMessage = {
      type: "unfocus-resource",
      windowId: windowId.current,
    };
    
    channelRef.current?.postMessage(message);
    setFocusedResource({ resourceId: null, resourceName: null, windowId: null });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const assignJobToFocusedResource = useCallback((jobId: string, date: string) => {
    if (!focusedResource.resourceId) return;
    
    const message: AssignJobMessage = {
      type: "assign-job",
      jobId,
      resourceId: focusedResource.resourceId,
      date,
    };
    
    channelRef.current?.postMessage(message);
  }, [focusedResource.resourceId]);

  const onJobAssignment = useCallback((callback: (jobId: string, resourceId: string, date: string) => void) => {
    if (!channelRef.current) return () => {};
    
    const handler = (event: MessageEvent<ChannelMessage>) => {
      if (event.data.type === "assign-job") {
        callback(event.data.jobId, event.data.resourceId, event.data.date);
      }
    };
    
    channelRef.current.addEventListener("message", handler);
    return () => channelRef.current?.removeEventListener("message", handler);
  }, []);

  const notifyJobAssigned = useCallback((jobId: string, resourceId: string, success: boolean) => {
    const message: JobAssignedMessage = {
      type: "job-assigned",
      jobId,
      resourceId,
      success,
    };
    channelRef.current?.postMessage(message);
  }, []);

  return {
    focusedResource,
    focusResource,
    unfocusResource,
    assignJobToFocusedResource,
    onJobAssignment,
    notifyJobAssigned,
    windowId: windowId.current,
  };
}
