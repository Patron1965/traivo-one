import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { GripVertical, Clock, ChevronDown, ChevronUp, MapPin, Navigation, AlertTriangle } from "lucide-react";
import type { WorkOrderWithObject, Customer } from "@shared/schema";
import { priorityDotColors, priorityLabels } from "./types";

export function SubStepsExpander({ jobId, isExpanded, onToggle }: { jobId: string; isExpanded: boolean; onToggle: () => void }) {
  const { data: subSteps } = useQuery<Array<{ id: string; title: string; stepOrder: number; status: string }>>({
    queryKey: ["/api/work-orders", jobId, "sub-steps"],
    queryFn: async () => {
      const res = await fetch(`/api/work-orders/${jobId}/sub-steps`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 120000,
  });

  if (!subSteps || subSteps.length === 0) return null;

  const completedCount = subSteps.filter(s => s.status === "completed").length;

  return (
    <div className="mt-1">
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        data-testid={`substeps-toggle-${jobId}`}
      >
        {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
        {completedCount}/{subSteps.length} steg klara
      </button>
      {isExpanded && (
        <div className="mt-1 space-y-0.5 pl-2 border-l border-muted">
          {subSteps.sort((a, b) => a.stepOrder - b.stepOrder).map(step => (
            <div key={step.id} className="flex items-center gap-1.5 text-[10px]">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${step.status === "completed" ? "bg-green-500" : step.status === "in_progress" ? "bg-blue-500" : "bg-gray-300"}`} />
              <span className={step.status === "completed" ? "line-through text-muted-foreground" : ""}>{step.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DraggableJobCard({ id, children, disabled = false }: { id: string; children: JSX.Element; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.3 : 1 }
    : undefined;
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={style} className="touch-none select-none">
      {children}
    </div>
  );
}

export function DroppableCell({ id, children, className = "", dropFitInfo, style, dragOverConflicts }: { id: string; children: JSX.Element; className?: string; dropFitInfo?: { bg: string; label: string; color: string } | null; style?: React.CSSProperties; dragOverConflicts?: string[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const hasConflict = isOver && dragOverConflicts && dragOverConflicts.length > 0;
  return (
    <div
      ref={setNodeRef}
      className={`${className} ${hasConflict ? "bg-red-50 dark:bg-red-950/30 ring-2 ring-red-500" : isOver ? dropFitInfo ? `${dropFitInfo.bg} ring-2 ${dropFitInfo.bg.includes("ring-") ? "" : "ring-primary"}` : "bg-primary/10 ring-2 ring-primary/30" : ""}`}
      style={style}
      data-testid={`droppable-cell-${id}`}
    >
      {hasConflict && (
        <div className="text-[10px] font-medium text-red-600 dark:text-red-400 mb-1 flex items-center gap-1" data-testid={`drag-conflict-${id}`}>
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">{dragOverConflicts[0]}</span>
        </div>
      )}
      {isOver && !hasConflict && dropFitInfo && (
        <div className={`text-[10px] font-medium ${dropFitInfo.color} mb-1 flex items-center gap-1`}>
          <span className={`w-2 h-2 rounded-full ${dropFitInfo.bg.split(" ")[0]}`} />
          {dropFitInfo.label}
        </div>
      )}
      {children}
    </div>
  );
}

export const SortableRouteItem = memo(function SortableRouteItem({
  job,
  index,
  totalCount,
  customer,
  travelToNext,
  isSelected,
  onSelect,
}: {
  job: WorkOrderWithObject;
  index: number;
  totalCount: number;
  customer?: Customer;
  travelToNext?: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card
        className={`p-2 cursor-pointer hover-elevate ${isSelected ? "ring-2 ring-primary" : ""} ${isDragging ? "shadow-xl" : ""}`}
        onClick={() => onSelect(job.id)}
        data-testid={`route-stop-${job.id}`}
      >
        <div className="flex items-start gap-2">
          <div {...attributes} {...listeners} className="cursor-grab pt-1 touch-none">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
            index === 0 ? "bg-green-500" : index === totalCount - 1 ? "bg-red-500" : "bg-blue-500"
          }`}>
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full shrink-0 ${priorityDotColors[job.priority]}`} />
              <span className="text-xs font-medium truncate">{job.title}</span>
            </div>
            <div className="text-[10px] text-muted-foreground truncate">{job.objectName}</div>
            {customer && (
              <div className="text-[10px] text-muted-foreground truncate">{customer.name}</div>
            )}
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {job.scheduledStartTime && (
                <Badge variant="outline" className="text-[9px] h-4 gap-0.5">
                  <Clock className="h-2 w-2" />
                  {job.scheduledStartTime}
                </Badge>
              )}
              <Badge variant="secondary" className="text-[9px] h-4">
                {((job.estimatedDuration || 0) / 60).toFixed(1).replace(".", ",")} h
              </Badge>
            </div>
          </div>
        </div>
      </Card>
      {travelToNext && index < totalCount - 1 && (
        <div className="flex items-center gap-1 py-1 px-2 text-[10px] text-muted-foreground">
          <Navigation className="h-2.5 w-2.5" />
          <span>~{travelToNext} min körtid</span>
        </div>
      )}
    </div>
  );
});
