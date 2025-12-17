import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SettingsPage() {
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inställningar</h1>
        <p className="text-sm text-muted-foreground">Hantera ditt konto och systempreferenser</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Utseende</CardTitle>
          <CardDescription>Anpassa hur applikationen ser ut</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Tema</Label>
              <p className="text-sm text-muted-foreground">Välj mellan ljust och mörkt tema</p>
            </div>
            <ThemeToggle />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profil</CardTitle>
          <CardDescription>Din kontoinformation</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">Förnamn</Label>
              <Input id="firstName" defaultValue="Anna" data-testid="input-first-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Efternamn</Label>
              <Input id="lastName" defaultValue="Andersson" data-testid="input-last-name" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-post</Label>
            <Input id="email" type="email" defaultValue="anna@kinab.se" data-testid="input-email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefon</Label>
            <Input id="phone" defaultValue="+46701234568" data-testid="input-phone" />
          </div>
          <Button data-testid="button-save-profile">Spara ändringar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notifikationer</CardTitle>
          <CardDescription>Hantera hur du vill bli notifierad</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>E-postnotifikationer</Label>
              <p className="text-sm text-muted-foreground">Ta emot uppdateringar via e-post</p>
            </div>
            <Switch defaultChecked data-testid="switch-email-notifications" />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Schemaändringar</Label>
              <p className="text-sm text-muted-foreground">Notifiera vid ändringar i veckoplaneringen</p>
            </div>
            <Switch defaultChecked data-testid="switch-schedule-notifications" />
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Akuta jobb</Label>
              <p className="text-sm text-muted-foreground">Notifiera omedelbart vid akuta jobb</p>
            </div>
            <Switch defaultChecked data-testid="switch-urgent-notifications" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Företagsinformation</CardTitle>
          <CardDescription>Information om Kinab AB</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Företagsnamn</span>
            <span>Kinab AB</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Plan</span>
            <span>Pro (Prototyp)</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Användare</span>
            <span>4 av 10</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
