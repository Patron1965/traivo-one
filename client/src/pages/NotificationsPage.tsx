import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bell, ChevronLeft, ChevronRight, ExternalLink, Inbox, CheckCheck } from "lucide-react";

interface UserNotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: UserNotificationItem[];
  unreadCount: number;
  total?: number;
}

interface TypesResponse {
  types: string[];
}

const PAGE_SIZE = 25;

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "nu";
  if (m < 60) return `${m} min sedan`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h sedan`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} d sedan`;
  return new Date(iso).toLocaleDateString("sv-SE");
}

function formatAbsoluteTime(iso: string): string {
  return new Date(iso).toLocaleString("sv-SE", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function typeLabel(type: string): string {
  return type
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function NotificationsPage() {
  const [readFilter, setReadFilter] = useState<"all" | "unread" | "read">("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const offset = page * PAGE_SIZE;

  const queryKey = useMemo(
    () => ["/api/notifications", { offset, limit: PAGE_SIZE, status: readFilter, type: typeFilter }] as const,
    [offset, readFilter, typeFilter]
  );

  const { data, isLoading } = useQuery<NotificationsResponse>({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      params.set("includeTotal", "true");
      if (readFilter !== "all") params.set("status", readFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);
      const res = await fetch(`/api/notifications?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Kunde inte hämta notiser");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const { data: typesData } = useQuery<TypesResponse>({
    queryKey: ["/api/notifications/types"],
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/notifications/read-all", {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    },
  });

  const items = data?.notifications ?? [];

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const unread = data?.unreadCount ?? 0;
  const types = typesData?.types ?? [];

  const handleFilterChange = (next: () => void) => {
    setPage(0);
    next();
  };

  return (
    <div className="container mx-auto p-4 md:p-6 max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center">
            <Bell className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">
              Notiser
            </h1>
            <p className="text-sm text-muted-foreground" data-testid="text-page-subtitle">
              Full historik av dina in-app-notiser{unread > 0 ? ` — ${unread} olästa` : ""}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAllRead.mutate()}
          disabled={markAllRead.isPending || unread === 0}
          data-testid="button-mark-all-read"
        >
          <CheckCheck className="h-4 w-4 mr-2" />
          Markera alla som lästa
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filter</CardTitle>
          <CardDescription>Filtrera per status och typ</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col md:flex-row md:items-center gap-3">
          <Tabs
            value={readFilter}
            onValueChange={(v) => handleFilterChange(() => setReadFilter(v as "all" | "unread" | "read"))}
            className="w-full md:w-auto"
          >
            <TabsList data-testid="tabs-read-filter">
              <TabsTrigger value="all" data-testid="tab-all">Alla</TabsTrigger>
              <TabsTrigger value="unread" data-testid="tab-unread">Olästa{unread > 0 ? ` (${unread})` : ""}</TabsTrigger>
              <TabsTrigger value="read" data-testid="tab-read">Lästa</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="md:ml-auto w-full md:w-64">
            <Select
              value={typeFilter}
              onValueChange={(v) => handleFilterChange(() => setTypeFilter(v))}
            >
              <SelectTrigger data-testid="select-type-filter">
                <SelectValue placeholder="Typ" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" data-testid="option-type-all">Alla typer</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t} data-testid={`option-type-${t}`}>
                    {typeLabel(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="divide-y">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center" data-testid="text-empty-state">
              <Inbox className="h-10 w-10 mx-auto text-muted-foreground/60 mb-3" />
              <p className="text-sm text-muted-foreground">Inga notiser matchar dina filter</p>
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const row = (
                  <div
                    className={`flex items-start gap-3 p-4 hover-elevate ${n.isRead ? "" : "bg-accent/30"}`}
                    data-testid={`notification-row-${n.id}`}
                  >
                    <div className="mt-1 flex-shrink-0">
                      {n.isRead ? (
                        <span className="h-2 w-2 rounded-full bg-transparent block" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-red-500 block" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium" data-testid={`text-notif-title-${n.id}`}>
                          {n.title}
                        </span>
                        <Badge variant="outline" className="text-[10px] font-normal" data-testid={`badge-notif-type-${n.id}`}>
                          {typeLabel(n.type)}
                        </Badge>
                        {n.link && (
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 break-words" data-testid={`text-notif-message-${n.id}`}>
                        {n.message}
                      </p>
                      <div className="text-[11px] text-muted-foreground mt-1.5" title={formatAbsoluteTime(n.createdAt)} data-testid={`text-notif-time-${n.id}`}>
                        {formatRelativeTime(n.createdAt)} · {formatAbsoluteTime(n.createdAt)}
                      </div>
                    </div>
                    {!n.isRead && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          markRead.mutate(n.id);
                        }}
                        data-testid={`button-mark-read-${n.id}`}
                      >
                        Markera läst
                      </Button>
                    )}
                  </div>
                );
                return (
                  <li key={n.id}>
                    {n.link ? (
                      <Link
                        href={n.link}
                        onClick={() => {
                          if (!n.isRead) markRead.mutate(n.id);
                        }}
                        data-testid={`link-notif-${n.id}`}
                      >
                        {row}
                      </Link>
                    ) : (
                      row
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground" data-testid="text-pagination-summary">
            Visar {offset + 1}–{Math.min(offset + items.length, total)} av {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              data-testid="button-prev-page"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Föregående
            </Button>
            <span className="text-muted-foreground" data-testid="text-page-indicator">
              Sida {page + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page + 1 >= totalPages}
              data-testid="button-next-page"
            >
              Nästa
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
