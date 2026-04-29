import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Truck } from "lucide-react";

export default function FieldLoginPage() {
  const handleLogin = () => {
    sessionStorage.setItem("field_login_redirect", "/field");
    window.location.href = "/api/login";
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/10 to-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-16 h-16 bg-primary rounded-full flex items-center justify-center">
            <Truck className="h-8 w-8 text-primary-foreground" />
          </div>
          <div>
            <CardTitle className="text-2xl">Traivo Go</CardTitle>
            <CardDescription>Logga in för att se dagens jobb</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button 
            onClick={handleLogin}
            className="w-full" 
            size="lg"
            data-testid="button-field-login"
          >
            Logga in
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Traivo Go — för chaufförer och tekniker
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
