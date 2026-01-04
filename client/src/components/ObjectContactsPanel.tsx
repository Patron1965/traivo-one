import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Phone, Mail, User, Building2, ArrowDown, Trash2, Edit2 } from "lucide-react";
import type { ObjectContact, ServiceObject } from "@shared/schema";

interface ObjectContactsPanelProps {
  objectId: string;
  tenantId: string;
  readOnly?: boolean;
}

interface ObjectContactsDialogProps {
  object: ServiceObject;
  trigger?: React.ReactNode;
}

const CONTACT_TYPES = [
  { value: "primary", label: "Primär kontakt" },
  { value: "invoice", label: "Fakturakontakt" },
  { value: "technical", label: "Teknisk kontakt" },
  { value: "emergency", label: "Nödkontakt" },
  { value: "property_manager", label: "Fastighetsförvaltare" },
];

export function ObjectContactsPanel({ objectId, tenantId, readOnly = false }: ObjectContactsPanelProps) {
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<ObjectContact | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    contactType: "primary",
    phone: "",
    email: "",
    role: "",
    isInheritable: true,
  });

  const { data: contacts = [], isLoading } = useQuery<ObjectContact[]>({
    queryKey: ["/api/objects", objectId, "contacts", "inherited"],
    queryFn: () => fetch(`/api/objects/${objectId}/contacts?inherited=true`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof formData) =>
      apiRequest("POST", `/api/objects/${objectId}/contacts`, {
        ...data,
        tenantId,
        objectId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      setIsDialogOpen(false);
      resetForm();
      toast({ title: "Kontakt skapad" });
    },
    onError: () => toast({ title: "Kunde inte skapa kontakt", variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof formData }) =>
      apiRequest("PATCH", `/api/objects/${objectId}/contacts/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      setIsDialogOpen(false);
      setEditingContact(null);
      resetForm();
      toast({ title: "Kontakt uppdaterad" });
    },
    onError: () => toast({ title: "Kunde inte uppdatera kontakt", variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiRequest("DELETE", `/api/objects/${objectId}/contacts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/objects", objectId, "contacts"] });
      toast({ title: "Kontakt borttagen" });
    },
    onError: () => toast({ title: "Kunde inte ta bort kontakt", variant: "destructive" }),
  });

  const resetForm = () => {
    setFormData({
      name: "",
      contactType: "primary",
      phone: "",
      email: "",
      role: "",
      isInheritable: true,
    });
  };

  const handleEdit = (contact: ObjectContact) => {
    setEditingContact(contact);
    setFormData({
      name: contact.name || "",
      contactType: contact.contactType || "primary",
      phone: contact.phone || "",
      email: contact.email || "",
      role: contact.role || "",
      isInheritable: contact.isInheritable ?? true,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    setEditingContact(null);
    resetForm();
  };

  const getContactTypeLabel = (type: string) =>
    CONTACT_TYPES.find(t => t.value === type)?.label || type;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            Kontakter
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-2">
            <div className="h-12 bg-muted rounded" />
            <div className="h-12 bg-muted rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <User className="h-4 w-4" />
          Kontakter
          <Badge variant="secondary" className="ml-1">{contacts.length}</Badge>
        </CardTitle>
        {!readOnly && (
          <Dialog open={isDialogOpen} onOpenChange={(open) => {
            if (!open) handleDialogClose();
            else setIsDialogOpen(true);
          }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" data-testid="button-add-contact">
                <Plus className="h-4 w-4 mr-1" />
                Lägg till
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingContact ? "Redigera kontakt" : "Lägg till kontakt"}
                </DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Namn</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Anna Andersson"
                    required
                    data-testid="input-contact-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactType">Typ</Label>
                  <Select
                    value={formData.contactType}
                    onValueChange={(value) => setFormData({ ...formData, contactType: value })}
                  >
                    <SelectTrigger data-testid="select-contact-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTACT_TYPES.map(type => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">Roll</Label>
                  <Input
                    id="role"
                    value={formData.role}
                    onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                    placeholder="Vaktmästare, Styrelseordförande"
                    data-testid="input-contact-role"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="phone">Telefon</Label>
                    <Input
                      id="phone"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      placeholder="070-123 45 67"
                      data-testid="input-contact-phone"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">E-post</Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="anna@example.com"
                      data-testid="input-contact-email"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="isInheritable"
                    checked={formData.isInheritable}
                    onCheckedChange={(checked) => setFormData({ ...formData, isInheritable: checked })}
                    data-testid="switch-contact-inheritable"
                  />
                  <Label htmlFor="isInheritable" className="text-sm">
                    Ärv till underliggande objekt
                  </Label>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={handleDialogClose}>
                    Avbryt
                  </Button>
                  <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-contact"
                  >
                    {editingContact ? "Spara" : "Lägg till"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {contacts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Inga kontakter registrerade
          </p>
        ) : (
          contacts.map((contact) => {
            const isInherited = contact.inheritedFromObjectId && contact.inheritedFromObjectId !== objectId;
            return (
              <div
                key={contact.id}
                className="flex items-start justify-between gap-2 p-3 rounded-md bg-muted/50"
                data-testid={`contact-item-${contact.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{contact.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {getContactTypeLabel(contact.contactType || "primary")}
                    </Badge>
                    {isInherited && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <ArrowDown className="h-3 w-3" />
                        Ärvd
                      </Badge>
                    )}
                    {contact.isInheritable && !isInherited && (
                      <Badge variant="secondary" className="text-xs">
                        <Building2 className="h-3 w-3 mr-1" />
                        Ärvs
                      </Badge>
                    )}
                  </div>
                  {contact.role && (
                    <p className="text-xs text-muted-foreground mt-0.5">{contact.role}</p>
                  )}
                  <div className="flex flex-wrap gap-3 mt-1.5">
                    {contact.phone && (
                      <a
                        href={`tel:${contact.phone}`}
                        className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
                        data-testid={`link-phone-${contact.id}`}
                      >
                        <Phone className="h-3 w-3" />
                        {contact.phone}
                      </a>
                    )}
                    {contact.email && (
                      <a
                        href={`mailto:${contact.email}`}
                        className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground"
                        data-testid={`link-email-${contact.id}`}
                      >
                        <Mail className="h-3 w-3" />
                        {contact.email}
                      </a>
                    )}
                  </div>
                </div>
                {!readOnly && !isInherited && (
                  <div className="flex gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleEdit(contact)}
                      data-testid={`button-edit-contact-${contact.id}`}
                    >
                      <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => deleteMutation.mutate(contact.id)}
                      disabled={deleteMutation.isPending}
                      data-testid={`button-delete-contact-${contact.id}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export function ObjectContactsDialog({ object, trigger }: ObjectContactsDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm" data-testid={`button-contacts-${object.id}`}>
            <User className="h-4 w-4 mr-1" />
            Kontakter
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Kontakter - {object.name}
          </DialogTitle>
        </DialogHeader>
        {open && (
          <ObjectContactsPanel
            objectId={object.id}
            tenantId={object.tenantId}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
