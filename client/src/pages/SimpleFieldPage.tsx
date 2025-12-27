import { AIFieldAssistant } from "@/components/AIFieldAssistant";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { useState, useEffect } from "react";
import { Sparkles, LogIn, Loader2, Mail, KeyRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface AuthenticatedResource {
  id: string;
  tenantId: string;
  name: string;
  initials?: string;
  resourceType: string;
  phone?: string;
  email?: string;
  status: string;
}

interface AuthSession {
  resource: AuthenticatedResource;
  token: string;
}

export default function SimpleFieldPage() {
  const { toast } = useToast();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const savedSession = localStorage.getItem("fieldAppSession");
    if (savedSession) {
      try {
        const parsed = JSON.parse(savedSession);
        setSession(parsed);
      } catch {
        localStorage.removeItem("fieldAppSession");
      }
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/mobile/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), pin }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Inloggningen misslyckades");
      }

      const newSession: AuthSession = {
        resource: data.resource,
        token: data.token,
      };

      localStorage.setItem("fieldAppSession", JSON.stringify(newSession));
      setSession(newSession);

      toast({
        title: "Inloggad",
        description: `Välkommen, ${data.resource.name}!`,
      });
    } catch (err: any) {
      setError(err.message || "Kunde inte logga in");
      toast({
        title: "Fel",
        description: err.message || "Inloggningen misslyckades",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    if (session?.token) {
      try {
        await fetch("/api/mobile/logout", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session.token}`,
            "Content-Type": "application/json",
          },
        });
      } catch {
      }
    }
    localStorage.removeItem("fieldAppSession");
    setSession(null);
    setEmail("");
    setPin("");
  };

  if (!session) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <div className="flex-1 flex items-center justify-center p-4">
          <Card className="w-full max-w-sm">
            <CardHeader className="text-center pb-2">
              <div className="flex items-center justify-center gap-2 mb-2">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <CardTitle className="text-2xl">AI Fältassistent</CardTitle>
              <CardDescription>
                Logga in med din e-post och PIN-kod
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-post</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="din@email.se"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10"
                      required
                      autoComplete="email"
                      data-testid="input-email"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pin">PIN-kod</Label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="pin"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="1234"
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="pl-10 text-center text-lg tracking-widest"
                      required
                      minLength={4}
                      maxLength={6}
                      data-testid="input-pin"
                    />
                  </div>
                </div>

                {error && (
                  <p className="text-sm text-destructive text-center" data-testid="text-error">
                    {error}
                  </p>
                )}

                <Button 
                  type="submit" 
                  className="w-full" 
                  size="lg"
                  disabled={isLoading || !email || pin.length < 4}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <LogIn className="h-4 w-4 mr-2" />
                  )}
                  Logga in
                </Button>
              </form>

              <div className="mt-6 pt-4 border-t">
                <p className="text-xs text-muted-foreground text-center">
                  Test: tomas@nordicrouting.se / PIN: 1234
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
        <PWAInstallPrompt />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <AIFieldAssistant 
        resourceId={session.resource.id} 
        resourceName={session.resource.name}
        onLogout={handleLogout}
      />
      <PWAInstallPrompt />
    </div>
  );
}
