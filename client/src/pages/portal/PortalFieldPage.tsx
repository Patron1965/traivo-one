import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Camera, QrCode, Search, MapPin, ArrowLeft, Send, Loader2,
  CheckCircle, AlertTriangle, Package, Wrench, Trash2, HelpCircle,
  Clock, Image, X, Building2, FileText, Navigation, ChevronRight
} from "lucide-react";
import { useTenantBranding } from "@/components/TenantBrandingProvider";

function getSessionToken(): string | null {
  return localStorage.getItem("portal_session");
}

function getCustomer(): { id: string; name: string; email: string } | null {
  const data = localStorage.getItem("portal_customer");
  return data ? JSON.parse(data) : null;
}

async function portalFetch(url: string, options: RequestInit = {}) {
  const token = getSessionToken();
  const res = await fetch(url, {
    ...options,
    headers: {
      ...options.headers,
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
    const error = await res.json();
    throw new Error(error.error || "Något gick fel");
  }
  return res.json();
}

interface FieldObject {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  city: string | null;
  objectType: string | null;
  latitude: number | null;
  longitude: number | null;
  reportCount: number;
}

interface ObjectDetail {
  id: string;
  name: string;
  objectNumber: string | null;
  address: string | null;
  city: string | null;
  objectType: string | null;
  latitude: number | null;
  longitude: number | null;
  accessCode: string | null;
  notes: string | null;
  metadata: { key: string; value: string | null }[];
  recentVisits: { id: string; scheduledDate: string | null; completedAt: string | null; status: string; description: string | null }[];
  changeRequests: { id: string; category: string; description: string; photos: string[] | null; status: string; createdAt: string; reviewNotes: string | null }[];
}

const CATEGORIES = [
  { value: "antal_karl_andrat", label: "Antal kärl ändrat", icon: Package },
  { value: "skadat_material", label: "Skadat material", icon: Wrench },
  { value: "tillganglighet", label: "Tillgänglighetsproblem", icon: AlertTriangle },
  { value: "skador", label: "Skador på utrymme", icon: AlertTriangle },
  { value: "rengorings_behov", label: "Rengöringsbehov", icon: Trash2 },
  { value: "ovrigt", label: "Övrigt", icon: HelpCircle },
];

function getCategoryLabel(value: string): string {
  return CATEGORIES.find(c => c.value === value)?.label || value;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "new": return <Badge className="bg-blue-500 text-white text-xs" data-testid="badge-status-new">Ny</Badge>;
    case "reviewed": return <Badge className="bg-amber-500 text-white text-xs" data-testid="badge-status-reviewed">Granskas</Badge>;
    case "resolved": return <Badge className="bg-green-500 text-white text-xs" data-testid="badge-status-resolved">Löst</Badge>;
    case "rejected": return <Badge variant="secondary" className="text-xs" data-testid="badge-status-rejected">Avvisad</Badge>;
    default: return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

type View = "list" | "object" | "report" | "scanner" | "success";

export default function PortalFieldPage() {
  const [, navigate] = useLocation();
  const branding = useTenantBranding();
  const customer = getCustomer();
  const primaryColor = branding?.primaryColor || "#1B4B6B";

  const [view, setView] = useState<View>("list");
  const [objects, setObjects] = useState<FieldObject[]>([]);
  const [selectedObject, setSelectedObject] = useState<ObjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [objectLoading, setObjectLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [reportCategory, setReportCategory] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [reportPhotos, setReportPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [gpsPosition, setGpsPosition] = useState<{ lat: number; lng: number } | null>(null);

  const scannerRef = useRef<any>(null);
  const scannerContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadObjects();
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setGpsPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {}
      );
    }
  }, []);

  async function loadObjects() {
    setLoading(true);
    setErrorMessage(null);
    try {
      const data = await portalFetch("/api/portal/field/objects");
      setObjects(data);
    } catch (err: any) {
      setErrorMessage(err.message || "Kunde inte ladda objekt");
    } finally {
      setLoading(false);
    }
  }

  async function loadObjectDetail(id: string) {
    setObjectLoading(true);
    setErrorMessage(null);
    try {
      const data = await portalFetch(`/api/portal/field/object/${id}`);
      setSelectedObject(data);
      setView("object");
    } catch (err: any) {
      setErrorMessage(err.message || "Kunde inte ladda objektdetaljer");
    } finally {
      setObjectLoading(false);
    }
  }

  async function startScanner() {
    setView("scanner");
    setScanError(null);
    setScannerActive(true);

    setTimeout(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (scannerRef.current) {
          try { await scannerRef.current.stop(); } catch {}
        }
        const scanner = new Html5Qrcode("qr-reader");
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decodedText: string) => {
            await scanner.stop();
            setScannerActive(false);
            handleQrResult(decodedText);
          },
          () => {}
        );
      } catch (err: any) {
        setScanError("Kunde inte starta kameran. Kontrollera att du har gett tillgång.");
        setScannerActive(false);
      }
    }, 100);
  }

  async function stopScanner() {
    if (scannerRef.current) {
      try { await scannerRef.current.stop(); } catch {}
      scannerRef.current = null;
    }
    setScannerActive(false);
    setView("list");
  }

  async function handleQrResult(text: string) {
    const codeMatch = text.match(/\/report\/([^/?]+)/);
    const code = codeMatch ? codeMatch[1] : text;

    try {
      const result = await portalFetch(`/api/portal/field/qr-lookup/${encodeURIComponent(code)}`);
      if (result.objectId) {
        await loadObjectDetail(result.objectId);
      }
    } catch (err: any) {
      setScanError(err.message || "QR-koden kunde inte identifieras");
      setView("list");
    }
  }

  async function handlePhotoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setErrorMessage(null);
    try {
      const { uploadURL, objectPath } = await portalFetch("/api/portal/field/upload-photo", {
        method: "POST",
      });

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!uploadRes.ok) {
        throw new Error("Kunde inte ladda upp fotot. Försök igen.");
      }

      await portalFetch("/api/portal/field/confirm-photo", {
        method: "POST",
        body: JSON.stringify({ objectPath }),
      });

      setReportPhotos(prev => [...prev, objectPath]);
    } catch (err: any) {
      setErrorMessage(err.message || "Fel vid fotouppladdning");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removePhoto(index: number) {
    setReportPhotos(prev => prev.filter((_, i) => i !== index));
  }

  async function submitReport() {
    if (!selectedObject || !reportCategory || !reportDescription) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await portalFetch("/api/portal/field/report", {
        method: "POST",
        body: JSON.stringify({
          objectId: selectedObject.id,
          category: reportCategory,
          description: reportDescription,
          photos: reportPhotos,
          latitude: gpsPosition?.lat || null,
          longitude: gpsPosition?.lng || null,
        }),
      });
      setView("success");
    } catch (err: any) {
      setErrorMessage(err.message || "Kunde inte skicka rapporten. Försök igen.");
    } finally {
      setSubmitting(false);
    }
  }

  function resetReport() {
    setReportCategory("");
    setReportDescription("");
    setReportPhotos([]);
    setView("list");
    setSelectedObject(null);
    loadObjects();
  }

  function openReportForm() {
    setReportCategory("");
    setReportDescription("");
    setReportPhotos([]);
    setView("report");
  }

  const filteredObjects = objects.filter(o =>
    !search || o.name.toLowerCase().includes(search.toLowerCase()) ||
    o.address?.toLowerCase().includes(search.toLowerCase()) ||
    o.objectNumber?.toLowerCase().includes(search.toLowerCase())
  );

  if (!customer) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground mb-4">Du måste vara inloggad för att använda fältdokumentation.</p>
            <Button onClick={() => navigate("/portal")} data-testid="button-goto-login">Logga in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur" style={{ borderBottomColor: primaryColor + "30" }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            {view !== "list" && (
              <Button variant="ghost" size="icon" onClick={() => {
                if (view === "scanner") { stopScanner(); }
                else if (view === "report") { setView("object"); }
                else if (view === "success") { resetReport(); }
                else { setView("list"); setSelectedObject(null); }
              }} data-testid="button-back">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            )}
            <div>
              <h1 className="text-lg font-semibold" data-testid="text-page-title">
                {view === "list" && "Fältdokumentation"}
                {view === "object" && (selectedObject?.name || "Objekt")}
                {view === "report" && "Ny rapport"}
                {view === "scanner" && "Skanna QR-kod"}
                {view === "success" && "Rapport skickad"}
              </h1>
              {view === "list" && (
                <p className="text-xs text-muted-foreground">{customer.name}</p>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/portal/dashboard")} data-testid="button-goto-dashboard">
            Dashboard
          </Button>
        </div>
      </header>

      <main className="p-4 max-w-lg mx-auto space-y-4 pb-24">
        {view === "list" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Button
                size="lg"
                className="h-24 flex-col gap-2 text-white"
                style={{ backgroundColor: primaryColor }}
                onClick={startScanner}
                data-testid="button-scan-qr"
              >
                <QrCode className="h-8 w-8" />
                <span className="text-sm font-medium">Skanna QR-kod</span>
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="h-24 flex-col gap-2"
                onClick={() => {
                  const searchInput = document.getElementById("object-search");
                  searchInput?.focus();
                }}
                data-testid="button-search-objects"
              >
                <Search className="h-8 w-8 text-muted-foreground" />
                <span className="text-sm font-medium">Sök objekt</span>
              </Button>
            </div>

            {scanError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg text-sm text-red-600" data-testid="text-scan-error">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {scanError}
              </div>
            )}

            {errorMessage && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg text-sm text-red-600" data-testid="text-error-message">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {errorMessage}
                <button className="ml-auto" onClick={() => setErrorMessage(null)}><X className="h-4 w-4" /></button>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="object-search"
                placeholder="Sök på namn, adress eller nummer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
                data-testid="input-search"
              />
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredObjects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Building2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">{search ? "Inga objekt matchar sökningen" : "Inga objekt hittades"}</p>
              </div>
            ) : (
              <div className="space-y-2" data-testid="list-objects">
                {filteredObjects.map(obj => (
                  <Card
                    key={obj.id}
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => loadObjectDetail(obj.id)}
                    data-testid={`card-object-${obj.id}`}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium text-sm truncate">{obj.name}</span>
                            {obj.reportCount > 0 && (
                              <Badge variant="secondary" className="text-[10px] shrink-0">{obj.reportCount} rapport{obj.reportCount !== 1 ? "er" : ""}</Badge>
                            )}
                          </div>
                          {obj.address && (
                            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{obj.address}{obj.city ? `, ${obj.city}` : ""}</span>
                            </div>
                          )}
                          {obj.objectType && (
                            <Badge variant="outline" className="text-[10px] mt-1">{obj.objectType}</Badge>
                          )}
                        </div>
                        <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {view === "scanner" && (
          <div className="space-y-4">
            <div
              id="qr-reader"
              ref={scannerContainerRef}
              className="w-full aspect-square rounded-lg overflow-hidden bg-black"
              data-testid="qr-scanner"
            />
            {scannerActive && (
              <p className="text-center text-sm text-muted-foreground">Rikta kameran mot QR-koden på objektet</p>
            )}
            {scanError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg text-sm text-red-600" data-testid="text-scanner-error">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {scanError}
              </div>
            )}
            <Button variant="outline" className="w-full" onClick={stopScanner} data-testid="button-stop-scanner">
              Avbryt skanning
            </Button>
          </div>
        )}

        {view === "object" && selectedObject && (
          <>
            {objectLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <Card data-testid="card-object-detail">
                  <CardContent className="p-4 space-y-3">
                    <div>
                      <h2 className="font-semibold text-lg" data-testid="text-object-name">{selectedObject.name}</h2>
                      {selectedObject.objectNumber && (
                        <p className="text-xs text-muted-foreground">Nr: {selectedObject.objectNumber}</p>
                      )}
                    </div>
                    {selectedObject.address && (
                      <div className="flex items-start gap-2 text-sm">
                        <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <span>{selectedObject.address}{selectedObject.city ? `, ${selectedObject.city}` : ""}</span>
                      </div>
                    )}
                    {selectedObject.accessCode && (
                      <div className="flex items-center gap-2 text-sm">
                        <Navigation className="h-4 w-4 text-muted-foreground" />
                        <span>Portkod: {selectedObject.accessCode}</span>
                      </div>
                    )}
                    {selectedObject.objectType && (
                      <Badge variant="outline" className="text-xs">{selectedObject.objectType}</Badge>
                    )}
                  </CardContent>
                </Card>

                <Button
                  size="lg"
                  className="w-full h-14 text-white text-base"
                  style={{ backgroundColor: primaryColor }}
                  onClick={openReportForm}
                  data-testid="button-new-report"
                >
                  <Camera className="h-5 w-5 mr-2" />
                  Rapportera ändring / problem
                </Button>

                {selectedObject.metadata.length > 0 && (
                  <Card data-testid="card-metadata">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <FileText className="h-4 w-4" />
                        Metadata
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="space-y-1">
                        {selectedObject.metadata.map((m, i) => (
                          <div key={i} className="flex justify-between text-sm py-1 border-b border-dashed last:border-0">
                            <span className="text-muted-foreground">{m.key}</span>
                            <span className="font-medium">{m.value || "—"}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {selectedObject.recentVisits.length > 0 && (
                  <Card data-testid="card-recent-visits">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Senaste besök
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="space-y-2">
                        {selectedObject.recentVisits.map(v => (
                          <div key={v.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                            <span className="text-muted-foreground">
                              {v.completedAt ? new Date(v.completedAt).toLocaleDateString("sv") : v.scheduledDate ? new Date(v.scheduledDate).toLocaleDateString("sv") : "—"}
                            </span>
                            <Badge variant={v.status === "completed" ? "default" : "outline"} className="text-[10px]">
                              {v.status === "completed" ? "Utförd" : v.status === "scheduled" ? "Planerad" : v.status}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {selectedObject.changeRequests.length > 0 && (
                  <Card data-testid="card-previous-reports">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4" />
                        Tidigare rapporter
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <div className="space-y-2">
                        {selectedObject.changeRequests.map(cr => (
                          <div key={cr.id} className="p-2 rounded border text-sm" data-testid={`report-${cr.id}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-xs">{getCategoryLabel(cr.category)}</span>
                              {getStatusBadge(cr.status)}
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">{cr.description}</p>
                            <p className="text-[10px] text-muted-foreground mt-1">{new Date(cr.createdAt).toLocaleDateString("sv")}</p>
                            {cr.reviewNotes && (
                              <p className="text-xs text-blue-600 mt-1">Svar: {cr.reviewNotes}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </>
        )}

        {view === "report" && selectedObject && (
          <div className="space-y-4">
            <Card data-testid="card-report-object-info">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 text-sm">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">{selectedObject.name}</span>
                </div>
                {selectedObject.address && (
                  <p className="text-xs text-muted-foreground ml-6">{selectedObject.address}</p>
                )}
              </CardContent>
            </Card>

            <div className="space-y-3">
              <label className="text-sm font-medium">Kategori *</label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map(cat => {
                  const Icon = cat.icon;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      className={`flex items-center gap-2 p-3 rounded-lg border text-left text-sm transition-colors ${
                        reportCategory === cat.value
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300"
                          : "border-muted hover:border-muted-foreground/30"
                      }`}
                      onClick={() => setReportCategory(cat.value)}
                      data-testid={`button-category-${cat.value}`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="text-xs">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Beskrivning *</label>
              <Textarea
                placeholder="Beskriv vad du ser..."
                value={reportDescription}
                onChange={(e) => setReportDescription(e.target.value)}
                rows={4}
                className="text-base"
                data-testid="input-description"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Foton</label>
              <div className="flex flex-wrap gap-2">
                {reportPhotos.filter(p => p.startsWith("/objects/")).map((photo, i) => (
                  <div key={i} className="relative w-20 h-20 rounded-lg border bg-muted overflow-hidden" data-testid={`photo-${i}`}>
                    <img src={photo} alt={`Foto ${i + 1}`} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <Image className="h-6 w-6 text-muted-foreground opacity-30" />
                    </div>
                    <button
                      className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white flex items-center justify-center z-10"
                      onClick={() => removePhoto(i)}
                      data-testid={`button-remove-photo-${i}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-muted-foreground/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-add-photo"
                >
                  {uploading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <Camera className="h-5 w-5" />
                      <span className="text-[10px]">Lägg till</span>
                    </>
                  )}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoCapture}
                data-testid="input-photo-file"
              />
            </div>

            {gpsPosition && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <MapPin className="h-3 w-3" />
                GPS-position registrerad
              </div>
            )}

            {errorMessage && (
              <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg text-sm text-red-600" data-testid="text-report-error">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {errorMessage}
                <button className="ml-auto" onClick={() => setErrorMessage(null)}><X className="h-4 w-4" /></button>
              </div>
            )}

            <Button
              size="lg"
              className="w-full h-14 text-white text-base"
              style={{ backgroundColor: primaryColor }}
              disabled={!reportCategory || !reportDescription || submitting}
              onClick={submitReport}
              data-testid="button-submit-report"
            >
              {submitting ? (
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
              ) : (
                <Send className="h-5 w-5 mr-2" />
              )}
              Skicka rapport
            </Button>
          </div>
        )}

        {view === "success" && (
          <div className="flex flex-col items-center justify-center py-12 text-center" data-testid="view-success">
            <div className="h-16 w-16 rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: primaryColor + "20" }}>
              <CheckCircle className="h-8 w-8" style={{ color: primaryColor }} />
            </div>
            <h2 className="text-xl font-semibold mb-2">Rapport skickad!</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Din rapport har registrerats och kommer att granskas av er tjänsteleverantör.
            </p>
            <div className="space-y-2 w-full">
              <Button className="w-full" style={{ backgroundColor: primaryColor, color: "white" }} onClick={resetReport} data-testid="button-new-report-after-success">
                Rapportera något mer
              </Button>
              <Button variant="outline" className="w-full" onClick={() => navigate("/portal/dashboard")} data-testid="button-goto-dashboard-success">
                Tillbaka till Dashboard
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
