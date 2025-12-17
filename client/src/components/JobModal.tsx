import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

// todo: remove mock functionality
const mockCustomers = [
  { id: "1", name: "Villa Skogsbacken AB" },
  { id: "2", name: "Fastighets AB Norrtull" },
  { id: "3", name: "Lars Larsson (privat)" },
];

// todo: remove mock functionality
const mockObjects = [
  { id: "1", name: "Brunn 1 - Skogsbacken", customerId: "1" },
  { id: "2", name: "Pump Station - Skogsbacken", customerId: "1" },
  { id: "3", name: "Huvudbrunn - Norrtull", customerId: "2" },
  { id: "4", name: "Privatbrunn - Täby", customerId: "3" },
];

// todo: remove mock functionality
const mockResources = [
  { id: "1", name: "Bengt Bengtsson" },
  { id: "2", name: "Carina Carlsson" },
];

interface JobModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit?: (data: JobFormData) => void;
}

interface JobFormData {
  title: string;
  description: string;
  customerId: string;
  objectId: string;
  orderType: string;
  priority: string;
  estimatedDuration: string;
  resourceId: string;
  scheduledDate: Date | undefined;
}

export function JobModal({ open, onClose, onSubmit }: JobModalProps) {
  const [formData, setFormData] = useState<JobFormData>({
    title: "",
    description: "",
    customerId: "",
    objectId: "",
    orderType: "service",
    priority: "normal",
    estimatedDuration: "60",
    resourceId: "",
    scheduledDate: undefined,
  });

  const filteredObjects = mockObjects.filter(o => 
    !formData.customerId || o.customerId === formData.customerId
  );

  const handleSubmit = () => {
    console.log("Job form submitted:", formData);
    onSubmit?.(formData);
    onClose();
    setFormData({
      title: "",
      description: "",
      customerId: "",
      objectId: "",
      orderType: "service",
      priority: "normal",
      estimatedDuration: "60",
      resourceId: "",
      scheduledDate: undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nytt jobb</DialogTitle>
          <DialogDescription>Fyll i jobbdetaljer för att skapa ett nytt arbetsorder.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="title">Titel</Label>
            <Input
              id="title"
              placeholder="T.ex. Årlig service"
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              data-testid="input-job-title"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kund</Label>
              <Select 
                value={formData.customerId} 
                onValueChange={(v) => setFormData({...formData, customerId: v, objectId: ""})}
              >
                <SelectTrigger data-testid="select-customer">
                  <SelectValue placeholder="Välj kund" />
                </SelectTrigger>
                <SelectContent>
                  {mockCustomers.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Objekt</Label>
              <Select 
                value={formData.objectId} 
                onValueChange={(v) => setFormData({...formData, objectId: v})}
              >
                <SelectTrigger data-testid="select-object">
                  <SelectValue placeholder="Välj objekt" />
                </SelectTrigger>
                <SelectContent>
                  {filteredObjects.map(o => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Jobbtyp</Label>
              <Select 
                value={formData.orderType} 
                onValueChange={(v) => setFormData({...formData, orderType: v})}
              >
                <SelectTrigger data-testid="select-order-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="service">Service</SelectItem>
                  <SelectItem value="repair">Reparation</SelectItem>
                  <SelectItem value="installation">Installation</SelectItem>
                  <SelectItem value="emergency">Akut</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Prioritet</Label>
              <Select 
                value={formData.priority} 
                onValueChange={(v) => setFormData({...formData, priority: v})}
              >
                <SelectTrigger data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Låg</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Hög</SelectItem>
                  <SelectItem value="urgent">Akut</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Beräknad tid (min)</Label>
              <Input
                type="number"
                value={formData.estimatedDuration}
                onChange={(e) => setFormData({...formData, estimatedDuration: e.target.value})}
                data-testid="input-duration"
              />
            </div>

            <div className="space-y-2">
              <Label>Tekniker</Label>
              <Select 
                value={formData.resourceId} 
                onValueChange={(v) => setFormData({...formData, resourceId: v})}
              >
                <SelectTrigger data-testid="select-resource">
                  <SelectValue placeholder="Välj tekniker" />
                </SelectTrigger>
                <SelectContent>
                  {mockResources.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Planerat datum</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start" data-testid="button-select-date">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {formData.scheduledDate ? format(formData.scheduledDate, "PPP", { locale: sv }) : "Välj datum"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={formData.scheduledDate}
                  onSelect={(d) => setFormData({...formData, scheduledDate: d})}
                  locale={sv}
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Beskrivning</Label>
            <Textarea
              id="description"
              placeholder="Beskrivning av jobbet..."
              value={formData.description}
              onChange={(e) => setFormData({...formData, description: e.target.value})}
              data-testid="input-description"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-cancel">
            Avbryt
          </Button>
          <Button onClick={handleSubmit} data-testid="button-save-job">
            Spara jobb
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
