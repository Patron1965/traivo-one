import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Truck } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueryState } from "@/components/QueryState";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { type Supplier } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "Namn krävs"),
  contact: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email("Ogiltig e-post").optional().or(z.literal("")).nullable(),
  status: z.enum(["active", "inactive"]),
});

type FormValues = z.infer<typeof formSchema>;

export default function SuppliersPage() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Supplier | null>(null);

  const {
    data: suppliers = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      contact: "",
      phone: "",
      email: "",
      status: "active",
    },
  });

  const openCreate = () => {
    setEditing(null);
    form.reset({ name: "", contact: "", phone: "", email: "", status: "active" });
    setDialogOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    form.reset({
      name: s.name,
      contact: s.contact ?? "",
      phone: s.phone ?? "",
      email: s.email ?? "",
      status: (s.status === "inactive" ? "inactive" : "active"),
    });
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const payload = {
        ...values,
        email: values.email || null,
        contact: values.contact || null,
        phone: values.phone || null,
      };
      if (editing) {
        return apiRequest("PATCH", `/api/suppliers/${editing.id}`, payload);
      }
      return apiRequest("POST", "/api/suppliers", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setDialogOpen(false);
      toast({ title: editing ? "Leverantör uppdaterad" : "Leverantör skapad" });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte spara", description: err?.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      setConfirmDelete(null);
      toast({ title: "Leverantör borttagen" });
    },
    onError: (err: any) => {
      toast({ title: "Kunde inte ta bort", description: err?.message, variant: "destructive" });
    },
  });

  return (
    <div className="h-full flex flex-col p-6">
      <div className="flex flex-col gap-4 mb-6">
        <PageHeader
          icon={Truck}
          title="Leverantörsregister"
          description="Leverantörsföretag med kontaktuppgifter. Koppla leverantörer till artiklar från artikelvyn."
          testId="text-suppliers-title"
        >
          <Button onClick={openCreate} data-testid="button-add-supplier">
            <Plus className="h-4 w-4 mr-2" />
            Ny leverantör
          </Button>
        </PageHeader>
      </div>

      <Card className="flex-1">
        <CardContent className="p-0">
          <QueryState
            isLoading={isLoading}
            isError={isError}
            isEmpty={suppliers.length === 0}
            error={error as any}
            onRetry={refetch}
            loadingVariant="skeleton-rows"
            emptyTitle="Inga leverantörer"
            emptyDescription="Lägg till din första leverantör för att börja."
            emptyAction={
              <Button onClick={openCreate} data-testid="button-add-supplier-empty">
                <Plus className="h-4 w-4 mr-2" />
                Ny leverantör
              </Button>
            }
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Namn</TableHead>
                  <TableHead>Kontakt</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>E-post</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Åtgärder</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((s) => (
                  <TableRow key={s.id} data-testid={`row-supplier-${s.id}`}>
                    <TableCell className="font-medium" data-testid={`text-supplier-name-${s.id}`}>{s.name}</TableCell>
                    <TableCell>{s.contact ?? "—"}</TableCell>
                    <TableCell>{s.phone ?? "—"}</TableCell>
                    <TableCell>{s.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "active" ? "default" : "secondary"} data-testid={`status-supplier-${s.id}`}>
                        {s.status === "active" ? "Aktiv" : "Inaktiv"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(s)} data-testid={`button-edit-supplier-${s.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setConfirmDelete(s)} data-testid={`button-delete-supplier-${s.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </QueryState>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="dialog-supplier">
          <DialogHeader>
            <DialogTitle>{editing ? "Redigera leverantör" : "Ny leverantör"}</DialogTitle>
            <DialogDescription>Fyll i leverantörens uppgifter.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => saveMutation.mutate(v))} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Namn</FormLabel>
                    <FormControl>
                      <Input {...field} data-testid="input-supplier-name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="contact"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Kontaktperson</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ""} data-testid="input-supplier-contact" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefon</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} data-testid="input-supplier-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-post</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} data-testid="input-supplier-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger data-testid="select-supplier-status">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="active">Aktiv</SelectItem>
                        <SelectItem value="inactive">Inaktiv</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} data-testid="button-cancel-supplier">
                  Avbryt
                </Button>
                <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-supplier">
                  {saveMutation.isPending ? "Sparar…" : "Spara"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent data-testid="dialog-delete-supplier">
          <AlertDialogHeader>
            <AlertDialogTitle>Ta bort leverantör?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.name} tas bort. Kopplingar till artiklar tas också bort.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-supplier">Avbryt</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
              data-testid="button-confirm-delete-supplier"
            >
              Ta bort
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
