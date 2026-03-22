import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { IotDevice, IotApiKey, IotSignal, ServiceObject } from "@shared/schema";
import { Radio, Key, Signal, Plus, Trash2, Copy, Battery, Loader2 } from "lucide-react";

export function IoTTab() {
  const { toast } = useToast();
  const { data: devices = [], isLoading: devicesLoading } = useQuery<IotDevice[]>({ queryKey: ["/api/iot/devices"] });
  const { data: apiKeys = [], isLoading: keysLoading } = useQuery<IotApiKey[]>({ queryKey: ["/api/iot/api-keys"] });
  const { data: signals = [] } = useQuery<IotSignal[]>({ queryKey: ["/api/iot/signals"] });
  const { data: allObjects = [] } = useQuery<ServiceObject[]>({ queryKey: ["/api/objects"] });

  const [newDeviceOpen, setNewDeviceOpen] = useState(false);
  const [newKeyOpen, setNewKeyOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [deviceForm, setDeviceForm] = useState({ objectId: "", deviceType: "fill_sensor", externalDeviceId: "" });

  const createDeviceMutation = useMutation({
    mutationFn: async (data: typeof deviceForm) => {
      const body: Record<string, string> = { objectId: data.objectId, deviceType: data.deviceType };
      if (data.externalDeviceId) body.externalDeviceId = data.externalDeviceId;
      return apiRequest("POST", "/api/iot/devices", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/devices"] });
      toast({ title: "Skapad", description: "IoT-enhet registrerad." });
      setNewDeviceOpen(false);
      setDeviceForm({ objectId: "", deviceType: "fill_sensor", externalDeviceId: "" });
    },
    onError: (e: Error) => toast({ title: "Kunde inte registrera IoT-enhet", description: e.message, variant: "destructive" }),
  });

  const deleteDeviceMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/iot/devices/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/devices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/iot/signals"] });
      toast({ title: "Borttagen", description: "IoT-enhet borttagen." });
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/iot/api-keys", { name });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/api-keys"] });
      setCreatedKey(data.apiKey);
      setNewKeyName("");
      toast({ title: "Skapad", description: "API-nyckel skapad. Kopiera den nu — den visas bara en gång." });
    },
    onError: (e: Error) => toast({ title: "Kunde inte skapa API-nyckel", description: e.message, variant: "destructive" }),
  });

  const deleteKeyMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/iot/api-keys/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/iot/api-keys"] });
      toast({ title: "Borttagen", description: "API-nyckel borttagen." });
    },
  });

  const objectMap = new Map(allObjects.map(o => [o.id, o.name]));

  if (devicesLoading || keysLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-teal-100 dark:bg-teal-900">
                <Radio className="h-5 w-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-iot-device-count">{devices.length}</p>
                <p className="text-sm text-muted-foreground">Registrerade enheter</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900">
                <Key className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-iot-key-count">{apiKeys.length}</p>
                <p className="text-sm text-muted-foreground">API-nycklar</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900">
                <Signal className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-iot-signal-count">{signals.length}</p>
                <p className="text-sm text-muted-foreground">Senaste signaler</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Radio className="h-5 w-5" />
                IoT-enheter
              </CardTitle>
              <CardDescription>Registrera sensorer kopplade till era objekt</CardDescription>
            </div>
            <Dialog open={newDeviceOpen} onOpenChange={setNewDeviceOpen}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-iot-device"><Plus className="h-4 w-4 mr-2" />Lägg till enhet</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Registrera IoT-enhet</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Objekt</Label>
                    <Select value={deviceForm.objectId} onValueChange={v => setDeviceForm(p => ({ ...p, objectId: v }))}>
                      <SelectTrigger data-testid="select-iot-object"><SelectValue placeholder="Välj objekt" /></SelectTrigger>
                      <SelectContent>
                        {allObjects.slice(0, 100).map(o => (
                          <SelectItem key={o.id} value={o.id}>{o.name} ({o.objectNumber || "—"})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Enhetstyp</Label>
                    <Select value={deviceForm.deviceType} onValueChange={v => setDeviceForm(p => ({ ...p, deviceType: v }))}>
                      <SelectTrigger data-testid="select-iot-device-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fill_sensor">Fyllnadssensor</SelectItem>
                        <SelectItem value="temperature">Temperatursensor</SelectItem>
                        <SelectItem value="weight">Viktsensor</SelectItem>
                        <SelectItem value="gps_tracker">GPS-tracker</SelectItem>
                        <SelectItem value="tilt_sensor">Lutningssensor</SelectItem>
                        <SelectItem value="fire_sensor">Brandsensor</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Externt enhets-ID (valfritt)</Label>
                    <Input
                      data-testid="input-iot-external-id"
                      value={deviceForm.externalDeviceId}
                      onChange={e => setDeviceForm(p => ({ ...p, externalDeviceId: e.target.value }))}
                      placeholder="t.ex. SEN-001-ABC"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    data-testid="button-save-iot-device"
                    onClick={() => createDeviceMutation.mutate(deviceForm)}
                    disabled={!deviceForm.objectId || createDeviceMutation.isPending}
                  >
                    {createDeviceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Registrera
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Objekt</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Externt ID</TableHead>
                <TableHead>Senaste signal</TableHead>
                <TableHead>Batteri</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map(d => (
                <TableRow key={d.id} data-testid={`row-iot-device-${d.id}`}>
                  <TableCell className="font-medium">{objectMap.get(d.objectId) || d.objectId}</TableCell>
                  <TableCell><Badge variant="outline">{d.deviceType}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{d.externalDeviceId || "—"}</TableCell>
                  <TableCell>
                    {d.lastSignal ? (
                      <span className="text-sm">{d.lastSignal} — {d.lastSignalAt ? new Date(d.lastSignalAt).toLocaleString("sv-SE") : ""}</span>
                    ) : <span className="text-muted-foreground text-sm">Ingen</span>}
                  </TableCell>
                  <TableCell>
                    {d.batteryLevel !== null && d.batteryLevel !== undefined ? (
                      <div className="flex items-center gap-1">
                        <Battery className={`h-4 w-4 ${d.batteryLevel < 20 ? "text-red-500" : d.batteryLevel < 50 ? "text-amber-500" : "text-green-500"}`} />
                        <span className="text-sm">{d.batteryLevel}%</span>
                      </div>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={d.status === "active" ? "default" : "secondary"}>{d.status === "active" ? "Aktiv" : d.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" data-testid={`button-delete-device-${d.id}`} onClick={() => deleteDeviceMutation.mutate(d.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {devices.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Inga IoT-enheter registrerade</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                API-nycklar
              </CardTitle>
              <CardDescription>Nycklar för att skicka IoT-signaler via POST /api/iot/signals</CardDescription>
            </div>
            <Dialog open={newKeyOpen} onOpenChange={(open) => { setNewKeyOpen(open); if (!open) setCreatedKey(null); }}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-iot-key"><Plus className="h-4 w-4 mr-2" />Skapa nyckel</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>{createdKey ? "API-nyckel skapad" : "Skapa API-nyckel"}</DialogTitle></DialogHeader>
                {createdKey ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">Kopiera nyckeln nu. Den visas bara en gång.</p>
                    <div className="flex items-center gap-2">
                      <Input value={createdKey} readOnly className="font-mono text-xs" data-testid="input-created-api-key" />
                      <Button variant="outline" size="sm" data-testid="button-copy-api-key" onClick={() => { navigator.clipboard.writeText(createdKey); toast({ title: "Kopierad" }); }}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Namn</Label>
                      <Input data-testid="input-iot-key-name" value={newKeyName} onChange={e => setNewKeyName(e.target.value)} placeholder="t.ex. Produktionssensorer" />
                    </div>
                  </div>
                )}
                <DialogFooter>
                  {!createdKey && (
                    <Button data-testid="button-save-iot-key" onClick={() => createKeyMutation.mutate(newKeyName)} disabled={!newKeyName || createKeyMutation.isPending}>
                      {createKeyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Skapa
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Namn</TableHead>
                <TableHead>Nyckel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Senast använd</TableHead>
                <TableHead>Skapad</TableHead>
                <TableHead className="w-[60px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.map(k => (
                <TableRow key={k.id} data-testid={`row-iot-key-${k.id}`}>
                  <TableCell className="font-medium">{k.name}</TableCell>
                  <TableCell className="font-mono text-xs">{k.apiKey}</TableCell>
                  <TableCell><Badge variant={k.status === "active" ? "default" : "secondary"}>{k.status === "active" ? "Aktiv" : k.status}</Badge></TableCell>
                  <TableCell className="text-sm">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("sv-SE") : "Aldrig"}</TableCell>
                  <TableCell className="text-sm">{new Date(k.createdAt).toLocaleDateString("sv-SE")}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" data-testid={`button-delete-key-${k.id}`} onClick={() => deleteKeyMutation.mutate(k.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {apiKeys.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Inga API-nycklar</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {signals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Signal className="h-5 w-5" />
              Senaste signaler
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tid</TableHead>
                  <TableHead>Typ</TableHead>
                  <TableHead>Enhet</TableHead>
                  <TableHead>Order skapad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {signals.slice(0, 20).map(s => (
                  <TableRow key={s.id} data-testid={`row-iot-signal-${s.id}`}>
                    <TableCell className="text-sm">{new Date(s.createdAt).toLocaleString("sv-SE")}</TableCell>
                    <TableCell><Badge variant="outline">{s.signalType}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{s.deviceId.slice(0, 8)}...</TableCell>
                    <TableCell>
                      {s.workOrderId ? (
                        <Badge variant="default" className="text-xs">Ja</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Nej</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
