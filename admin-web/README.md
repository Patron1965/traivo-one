# Admin Web – Planner / Scheduling Interface

This directory contains the **web-based admin scheduling interface** (React + Vite) for Traivo.

It is a standalone frontend that powers the drag-and-drop resource planner shown in the admin dashboard — separate from the React Native mobile app in `/client`.

## Key Components

| File | Purpose |
|---|---|
| `WeekGridView.tsx` | Weekly grid view with drag-and-drop scheduling |
| `DayTimelineView.tsx` | Daily hour-by-hour timeline view |
| `MonthView.tsx` | Monthly calendar overview |
| `RouteMapView.tsx` | Map-based route optimization view |
| `DndComponents.tsx` | Reusable drag-and-drop primitives (`DraggableJobCard`, `DroppableCell`, `SortableRouteItem`) |
| `JobCard.tsx` | Job card component used across all views |
| `UnscheduledSidebar.tsx` | Left sidebar listing unscheduled jobs |
| `PlannerToolbar.tsx` | Top toolbar with filters, search, and view toggles |
| `PlannerDialogs.tsx` | Modal dialogs for job details, assignment, etc. |
| `DisruptionPanel.tsx` | Panel showing scheduling conflicts and disruptions |
| `ResourceColumn.tsx` | Resource info column (name, capacity, avatar) |
| `ResourceDetailSheet.tsx` | Detailed resource information sheet |
| `usePlannerData.ts` | Data fetching and state management hook |
| `usePlannerDnd.ts` | Drag-and-drop logic and conflict detection hook |
| `types.ts` | Shared TypeScript types and constants |
| `index.ts` | Barrel export file |

## Recent Fix (2026-03-30)

**Bug:** Scheduled jobs in `WeekGridView` and `DayTimelineView` were not draggable because `JobCard` was rendered directly without being wrapped in `DraggableJobCard`.

**Fix:** Wrapped all scheduled `<JobCard>` instances in `<DraggableJobCard>` in both grid views, matching the pattern already used in `UnscheduledSidebar`.
