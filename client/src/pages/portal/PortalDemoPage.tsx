import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PortalDemoPage() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function demoLogin() {
      try {
        const res = await fetch("/api/portal/auth/demo-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Kunde inte logga in");
        }

        const data = await res.json();

        localStorage.setItem("portal_session", data.sessionToken);
        localStorage.setItem("portal_customer", JSON.stringify(data.customer));
        localStorage.setItem("portal_tenant", JSON.stringify(data.tenant));

        setStatus("success");
        setTimeout(() => {
          setLocation("/portal/dashboard");
        }, 800);
      } catch (err: any) {
        setStatus("error");
        setErrorMsg(err.message || "Något gick fel");
      }
    }

    demoLogin();
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <Card className="w-full max-w-md mx-4" data-testid="card-demo-login">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Demo Kundportal</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {status === "loading" && (
            <>
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <p className="text-muted-foreground">Loggar in som demokund...</p>
            </>
          )}
          {status === "success" && (
            <>
              <CheckCircle className="h-8 w-8 text-green-600" />
              <p className="text-green-700 dark:text-green-400 font-medium">Inloggad! Omdirigerar till kundportalen...</p>
            </>
          )}
          {status === "error" && (
            <>
              <AlertCircle className="h-8 w-8 text-red-600" />
              <p className="text-red-700 dark:text-red-400">{errorMsg}</p>
              <Button variant="outline" onClick={() => setLocation("/portal")} data-testid="button-back-portal">
                Tillbaka till inloggning
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
