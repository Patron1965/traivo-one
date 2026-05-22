import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <Card className="w-full max-w-md mx-4">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-8 w-8 text-muted-foreground" />
            <h1 className="text-2xl font-bold">Sidan hittades inte</h1>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            Sidan du söker finns inte eller har flyttats.
          </p>
          
          <Link href="/">
            <Button className="mt-6" data-testid="button-go-home">
              <Home className="h-4 w-4 mr-2" />
              Gå till startsidan
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
