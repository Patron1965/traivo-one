import { useEffect, useState, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export default function PortalVerifyPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const [errorMessage, setErrorMessage] = useState("");
  const verifyAttempted = useRef(false);

  useEffect(() => {
    if (verifyAttempted.current) return;

    const params = new URLSearchParams(searchString);
    const token = params.get("token");

    if (!token) {
      const existingSession = localStorage.getItem("portal_session");
      if (existingSession) {
        setStatus("success");
        setTimeout(() => setLocation("/portal/dashboard"), 500);
        return;
      }
      setStatus("error");
      setErrorMessage("Ingen token hittades i länken");
      return;
    }

    verifyAttempted.current = true;

    async function verify() {
      try {
        const res = await fetch("/api/portal/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });

        if (!res.ok) {
          const data = await res.json();
          const errorMsg = data.error || "Verifiering misslyckades";

          if (errorMsg.includes("redan använts")) {
            const existingSession = localStorage.getItem("portal_session");
            if (existingSession) {
              setStatus("success");
              setTimeout(() => setLocation("/portal/dashboard"), 500);
              return;
            }
          }

          throw new Error(errorMsg);
        }

        const data = await res.json();
        localStorage.setItem("portal_session", data.sessionToken);
        localStorage.setItem("portal_customer", JSON.stringify(data.customer));
        localStorage.setItem("portal_tenant", JSON.stringify(data.tenant));
        setStatus("success");
        setTimeout(() => setLocation("/portal/dashboard"), 1000);
      } catch (err: any) {
        setStatus("error");
        setErrorMessage(err.message || "Något gick fel");
      }
    }

    verify();
  }, [searchString, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted p-4">
      <Card className="w-full max-w-md" data-testid="card-verify">
        <CardHeader className="text-center">
          {status === "verifying" && (
            <>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
              </div>
              <CardTitle>Verifierar inloggning...</CardTitle>
              <CardDescription>Vänta medan vi verifierar din inloggningslänk</CardDescription>
            </>
          )}

          {status === "success" && (
            <>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <CardTitle>Inloggning lyckades!</CardTitle>
              <CardDescription>Du omdirigeras till kundportalen...</CardDescription>
            </>
          )}

          {status === "error" && (
            <>
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                <XCircle className="h-8 w-8 text-red-600 dark:text-red-400" />
              </div>
              <CardTitle>Inloggning misslyckades</CardTitle>
              <CardDescription>{errorMessage}</CardDescription>
            </>
          )}
        </CardHeader>

        {status === "error" && (
          <CardContent className="space-y-3">
            <Button
              className="w-full"
              onClick={() => setLocation("/portal")}
              data-testid="button-back-to-login"
            >
              Begär en ny inloggningslänk
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
