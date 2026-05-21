import { ShieldX, LogOut, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function AccessDeniedPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-8 pb-6 text-center space-y-6">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <ShieldX className="h-8 w-8 text-destructive" data-testid="icon-access-denied" />
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold" data-testid="text-access-denied-title">
              Åtkomst nekad
            </h1>
            <p className="text-muted-foreground" data-testid="text-access-denied-message">
              Ditt konto har inte behörighet att använda systemet. 
              Kontakta din administratör för att bli inbjuden.
            </p>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <Mail className="h-4 w-4" />
              Hur får jag åtkomst?
            </p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Be din administratör att skicka en inbjudan till din e-post</li>
              <li>Logga in igen efter att inbjudan skickats</li>
              <li>Du kopplas automatiskt till rätt organisation</li>
            </ol>
          </div>

          <Button
            variant="outline"
            className="w-full"
            data-testid="button-logout-access-denied"
            onClick={() => {
              window.location.href = "/api/logout";
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logga ut
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
