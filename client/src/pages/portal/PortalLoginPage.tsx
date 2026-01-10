import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Mail, 
  CheckCircle, 
  Loader2, 
  FileText, 
  Calendar, 
  Bell, 
  MessageSquare,
  Shield,
  Clock,
  Recycle
} from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Ange en giltig e-postadress"),
  tenantId: z.string().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

const features = [
  {
    icon: FileText,
    title: "Fakturor",
    description: "Se och hantera dina fakturor online"
  },
  {
    icon: Calendar,
    title: "Bokningar",
    description: "Boka och ändra hämtningar enkelt"
  },
  {
    icon: Bell,
    title: "Notiser",
    description: "Få aviseringar när tekniker är på väg"
  },
  {
    icon: MessageSquare,
    title: "Support",
    description: "Kontakta oss direkt via portalen"
  }
];

export default function PortalLoginPage() {
  const [emailSent, setEmailSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");

  const tenantsQuery = useQuery<{ id: string; name: string }[]>({
    queryKey: ["/api/portal/tenants"],
    queryFn: async () => {
      const res = await fetch("/api/portal/tenants");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const tenants = tenantsQuery.data || [];
  const isLoadingTenants = tenantsQuery.isLoading;
  const hasMultipleTenants = tenants.length > 1;

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      tenantId: "",
    },
  });

  useEffect(() => {
    if (tenants.length === 1) {
      form.setValue("tenantId", tenants[0].id);
    }
  }, [tenants, form]);

  const requestLinkMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const effectiveTenantId = data.tenantId || (tenants.length === 1 ? tenants[0].id : undefined);

      const res = await fetch("/api/portal/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          tenantId: effectiveTenantId,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Något gick fel");
      }
      return res.json();
    },
    onSuccess: (_, variables) => {
      setSentEmail(variables.email);
      setEmailSent(true);
    },
  });

  const onSubmit = (data: LoginForm) => {
    requestLinkMutation.mutate(data);
  };

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle>Kolla din e-post</CardTitle>
            <CardDescription className="mt-2">
              Vi har skickat en inloggningslänk till <strong>{sentEmail}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Klicka på länken i e-postmeddelandet för att logga in. Länken är giltig i 15 minuter.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setEmailSent(false);
                form.reset();
              }}
              data-testid="button-try-again"
            >
              Försök med en annan e-post
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted">
      <div className="container mx-auto px-4 py-8 lg:py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
          
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Recycle className="h-6 w-6" />
                </div>
                <span className="text-2xl font-bold">Kundportal</span>
              </div>
              
              <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">
                Hantera dina tjänster enkelt online
              </h1>
              
              <p className="text-lg text-muted-foreground">
                Välkommen till kundportalen. Här kan du se fakturor, boka tjänster, 
                följa leveranser och mycket mer – dygnet runt.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {features.map((feature) => (
                <div 
                  key={feature.title}
                  className="flex items-start gap-3 p-4 rounded-lg bg-card border"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <feature.icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                <span>Säker inloggning</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                <span>Tillgänglig 24/7</span>
              </div>
            </div>
          </div>

          <div className="lg:pl-8">
            <Card className="w-full max-w-md mx-auto shadow-lg">
              <CardHeader className="text-center pb-4">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <Mail className="h-7 w-7 text-primary" />
                </div>
                <CardTitle className="text-xl">Logga in</CardTitle>
                <CardDescription>
                  Ange din e-postadress så skickar vi en säker inloggningslänk
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    {hasMultipleTenants && (
                      <FormField
                        control={form.control}
                        name="tenantId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Företag</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-tenant">
                                  <SelectValue placeholder="Välj företag" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {tenants.map((tenant) => (
                                  <SelectItem key={tenant.id} value={tenant.id}>
                                    {tenant.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}

                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>E-postadress</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="din.epost@exempel.se"
                              type="email"
                              autoComplete="email"
                              className="h-11"
                              data-testid="input-email"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {requestLinkMutation.error && (
                      <p className="text-sm text-destructive" data-testid="text-error">
                        {requestLinkMutation.error.message}
                      </p>
                    )}

                    <Button
                      type="submit"
                      className="w-full h-11"
                      disabled={requestLinkMutation.isPending || isLoadingTenants}
                      data-testid="button-submit"
                    >
                      {requestLinkMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Skickar...
                        </>
                      ) : isLoadingTenants ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Laddar...
                        </>
                      ) : (
                        "Skicka inloggningslänk"
                      )}
                    </Button>
                  </form>
                </Form>

                <div className="mt-6 pt-4 border-t">
                  <p className="text-xs text-center text-muted-foreground">
                    Ingen registrering behövs. Vi skickar en säker länk till din e-post 
                    som är giltig i 15 minuter.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <footer className="mt-16 text-center text-sm text-muted-foreground">
          <p>Har du frågor? Kontakta kundtjänst på telefon eller e-post.</p>
        </footer>
      </div>
    </div>
  );
}
