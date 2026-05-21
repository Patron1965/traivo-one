import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ArrowLeft, MapPin, Calendar, User, Loader2, ImageIcon, X, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface CompletedJob {
  id: string;
  title: string;
  description?: string | null;
  completedAt: string;
  objectId?: string | null;
  objectName?: string | null;
  objectAddress?: string | null;
  status?: string | null;
  workDescription?: string | null;
  executedByName?: string | null;
  photos: string[];
}

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

async function portalFetch(url: string) {
  const token = getSessionToken();
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (res.status === 401) {
    localStorage.removeItem("portal_session");
    localStorage.removeItem("portal_customer");
    localStorage.removeItem("portal_tenant");
    window.location.href = "/portal";
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Något gick fel" }));
    throw new Error(err.error || "Något gick fel");
  }
  return res.json();
}

function resolvePhotoUrl(photo: string): string {
  if (!photo) return "";
  if (photo.startsWith("http://") || photo.startsWith("https://")) return photo;
  if (photo.startsWith("/")) return photo;
  return `/${photo}`;
}

export default function PortalCompletedJobsPage() {
  const { data: jobs, isLoading, error } = useQuery<CompletedJob[]>({
    queryKey: ["/api/portal/completed-jobs"],
    queryFn: () => portalFetch("/api/portal/completed-jobs"),
  });

  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null);

  const close = () => setLightbox(null);
  const prev = () =>
    setLightbox((s) => (s ? { ...s, index: (s.index - 1 + s.photos.length) % s.photos.length } : s));
  const next = () =>
    setLightbox((s) => (s ? { ...s, index: (s.index + 1) % s.photos.length } : s));

  const totalPhotos = jobs?.reduce((sum, j) => sum + j.photos.length, 0) ?? 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link href="/portal/dashboard">
            <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Tillbaka
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-[#1B4B6B]" />
            <h1 className="text-lg font-semibold" data-testid="text-page-title">Utförda jobb</h1>
          </div>
          {jobs && (
            <Badge variant="secondary" className="ml-auto" data-testid="badge-job-count">
              {jobs.length} jobb · {totalPhotos} bilder
            </Badge>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="p-12 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </CardContent>
          </Card>
        ) : error ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              Kunde inte ladda utförda jobb: {(error as Error).message}
            </CardContent>
          </Card>
        ) : !jobs || jobs.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-sm text-muted-foreground" data-testid="text-empty">
              Inga utförda jobb att visa ännu.
            </CardContent>
          </Card>
        ) : (
          jobs.map((job) => (
            <Card key={job.id} data-testid={`card-job-${job.id}`}>
              <CardContent className="p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-base" data-testid={`text-title-${job.id}`}>
                      {job.title}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {format(new Date(job.completedAt), "d MMM yyyy 'kl' HH:mm", { locale: sv })}
                      </span>
                      {job.objectName && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {job.objectName}
                          {job.objectAddress ? `, ${job.objectAddress}` : ""}
                        </span>
                      )}
                      {job.executedByName && (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {job.executedByName}
                        </span>
                      )}
                    </div>
                  </div>
                  {job.status && (
                    <Badge variant={job.status === "fakturerad" ? "default" : "secondary"}>
                      {job.status === "fakturerad" ? "Fakturerad" : "Utförd"}
                    </Badge>
                  )}
                </div>

                {(job.workDescription || job.description) && (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {job.workDescription || job.description}
                  </p>
                )}

                {job.photos.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {job.photos.map((photo, idx) => (
                      <button
                        key={`${job.id}-${idx}`}
                        type="button"
                        onClick={() => setLightbox({ photos: job.photos, index: idx })}
                        className="relative aspect-square rounded-md overflow-hidden border bg-gray-100 hover:opacity-90 transition"
                        data-testid={`button-photo-${job.id}-${idx}`}
                      >
                        <img
                          src={resolvePhotoUrl(photo)}
                          alt={`${job.title} – bild ${idx + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground italic" data-testid={`text-no-photos-${job.id}`}>
                    Inga bilder kopplade till detta jobb.
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={!!lightbox} onOpenChange={(o) => !o && close()}>
        <DialogContent className="max-w-4xl p-0 bg-black/95 border-0">
          {lightbox && (
            <div className="relative">
              <button
                type="button"
                onClick={close}
                className="absolute top-2 right-2 z-10 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
                data-testid="button-close-lightbox"
              >
                <X className="h-5 w-5" />
              </button>
              {lightbox.photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={prev}
                    className="absolute left-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
                    data-testid="button-prev-photo"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={next}
                    className="absolute right-2 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full bg-black/60 text-white hover:bg-black/80"
                    data-testid="button-next-photo"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}
              <img
                src={resolvePhotoUrl(lightbox.photos[lightbox.index])}
                alt={`Bild ${lightbox.index + 1}`}
                className="w-full max-h-[85vh] object-contain"
                data-testid="img-lightbox"
              />
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 text-white text-xs">
                {lightbox.index + 1} / {lightbox.photos.length}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
