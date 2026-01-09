import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Mail, CheckCircle, Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email("Ange en giltig e-postadress"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function PortalLoginPage() {
  const [emailSent, setEmailSent] = useState(false);
  const [sentEmail, setSentEmail] = useState("");

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
    },
  });

  const requestLinkMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const res = await fetch("/api/portal/auth/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          tenantId: "default-tenant",
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted p-4">
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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>Logga in på kundportalen</CardTitle>
          <CardDescription>
            Ange din e-postadress så skickar vi en inloggningslänk
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
                className="w-full"
                disabled={requestLinkMutation.isPending}
                data-testid="button-submit"
              >
                {requestLinkMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Skickar...
                  </>
                ) : (
                  "Skicka inloggningslänk"
                )}
              </Button>
            </form>
          </Form>

          <div className="mt-6 text-center">
            <p className="text-xs text-muted-foreground">
              Ingen registrering behövs. Vi skickar en säker länk till din e-post.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
