import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { MessageSquare, Settings, Send, AlertCircle, CheckCircle2, Loader2, ExternalLink, Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageHelp } from "@/components/ui/help-tooltip";

interface SmsConfig {
  smsEnabled: boolean;
  smsProvider: string;
  smsFromName: string;
}

export default function SmsSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testPhone, setTestPhone] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const configQuery = useQuery<SmsConfig>({
    queryKey: ["/api/system/sms-config"],
  });

  const [localConfig, setLocalConfig] = useState<SmsConfig>({
    smsEnabled: false,
    smsProvider: "none",
    smsFromName: "",
  });

  const hasChanges = configQuery.data && (
    localConfig.smsEnabled !== configQuery.data.smsEnabled ||
    localConfig.smsProvider !== configQuery.data.smsProvider ||
    localConfig.smsFromName !== configQuery.data.smsFromName
  );

  useEffect(() => {
    if (configQuery.data && !isSaving) {
      setLocalConfig(configQuery.data);
    }
  }, [configQuery.data, isSaving]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setIsSaving(true);
      return apiRequest("PUT", "/api/system/sms-config", localConfig);
    },
    onSuccess: () => {
      toast({
        title: "Inställningar sparade",
        description: "SMS-konfigurationen har uppdaterats.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/system/sms-config"] });
      setIsSaving(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte spara",
        description: error.message,
        variant: "destructive",
      });
      setIsSaving(false);
    },
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/system/sms-config/test", { phoneNumber: testPhone });
    },
    onSuccess: () => {
      toast({
        title: "Test-SMS skickat!",
        description: `Ett testmeddelande skickades till ${testPhone}`,
      });
      setTestPhone("");
    },
    onError: (error: Error) => {
      toast({
        title: "Kunde inte skicka test-SMS",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleTestSms = () => {
    if (!testPhone.trim()) {
      toast({
        title: "Telefonnummer krävs",
        description: "Ange ett telefonnummer för test-SMS",
        variant: "destructive",
      });
      return;
    }
    testMutation.mutate();
  };

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageSquare className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold" data-testid="text-page-title">SMS-inställningar</h1>
              <p className="text-muted-foreground">Konfigurera SMS-notifikationer för dina kunder</p>
            </div>
          </div>
          <PageHelp
            title="SMS-inställningar"
            description="Här konfigurerar du SMS-notifikationer för att skicka meddelanden till dina kunder. Du kan aktivera SMS-funktionen, välja leverantör och testa att det fungerar."
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Grundinställningar
            </CardTitle>
            <CardDescription>
              Aktivera och konfigurera SMS-tjänsten för din organisation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Aktivera SMS-notifikationer</Label>
                <p className="text-sm text-muted-foreground">
                  Möjliggör att skicka SMS till kunder
                </p>
              </div>
              <Switch
                checked={localConfig.smsEnabled}
                onCheckedChange={(checked) => setLocalConfig({ ...localConfig, smsEnabled: checked })}
                data-testid="switch-sms-enabled"
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <Label>SMS-leverantör</Label>
              <Select
                value={localConfig.smsProvider}
                onValueChange={(value) => setLocalConfig({ ...localConfig, smsProvider: value })}
                disabled={!localConfig.smsEnabled}
              >
                <SelectTrigger data-testid="select-sms-provider">
                  <SelectValue placeholder="Välj leverantör..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen (inaktiverad)</SelectItem>
                  <SelectItem value="twilio">Twilio</SelectItem>
                  <SelectItem value="46elks">46elks (kommer snart)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-sm text-muted-foreground">
                Välj vilken SMS-leverantör som ska användas för att skicka meddelanden
              </p>
            </div>

            <div className="space-y-2">
              <Label>Avsändarnamn</Label>
              <Input
                value={localConfig.smsFromName}
                onChange={(e) => setLocalConfig({ ...localConfig, smsFromName: e.target.value })}
                placeholder="T.ex. Nordfield AB"
                maxLength={100}
                disabled={!localConfig.smsEnabled}
                data-testid="input-sms-from-name"
              />
              <p className="text-sm text-muted-foreground">
                Namnet som visas som avsändare i SMS-meddelanden
              </p>
            </div>

            <div className="flex gap-2 pt-4">
              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !hasChanges}
                data-testid="button-save-sms-config"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Spara inställningar
              </Button>
              {hasChanges && (
                <Button
                  variant="outline"
                  onClick={() => configQuery.data && setLocalConfig(configQuery.data)}
                  data-testid="button-reset-sms-config"
                >
                  Återställ
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="h-5 w-5" />
              Testa SMS
            </CardTitle>
            <CardDescription>
              Skicka ett testmeddelande för att verifiera att SMS-tjänsten fungerar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!localConfig.smsEnabled || localConfig.smsProvider === "none" ? (
              <div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Aktivera SMS och välj en leverantör för att kunna testa
                </span>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Input
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    placeholder="+46701234567"
                    className="max-w-xs"
                    data-testid="input-test-phone"
                  />
                  <Button
                    onClick={handleTestSms}
                    disabled={testMutation.isPending || !testPhone.trim()}
                    data-testid="button-send-test-sms"
                  >
                    {testMutation.isPending ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4 mr-2" />
                    )}
                    Skicka test
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground">
                  Ange ett telefonnummer i internationellt format (t.ex. +46701234567)
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              Information om SMS-leverantörer
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="default">Twilio</Badge>
                <a 
                  href="https://www.twilio.com" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline flex items-center gap-1"
                >
                  twilio.com <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <p className="text-sm text-muted-foreground">
                Twilio är en global plattform för kommunikation. Du behöver skapa ett konto och 
                konfigurera anslutningen via Replits Twilio-integration i projektinställningarna.
              </p>
              <div className="text-sm bg-muted p-3 rounded-lg space-y-1">
                <p><strong>API-nycklar som behövs:</strong></p>
                <ul className="list-disc list-inside ml-2">
                  <li>Account SID</li>
                  <li>Auth Token</li>
                  <li>Telefonnummer (från Twilio)</li>
                </ul>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">46elks</Badge>
                <span className="text-xs text-muted-foreground">(Kommer snart)</span>
              </div>
              <p className="text-sm text-muted-foreground">
                46elks är en svensk SMS-leverantör som ofta är mer kostnadseffektiv för 
                nordiska telefonnummer.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              Automatiska SMS-notifikationer
            </CardTitle>
            <CardDescription>
              Dessa SMS skickas automatiskt när SMS-funktionen är aktiverad
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                <div>
                  <span className="font-medium">Tekniker på väg</span>
                  <p className="text-sm text-muted-foreground">Skickas när tekniker startar resan till kund</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                <div>
                  <span className="font-medium">Påminnelse om besök</span>
                  <p className="text-sm text-muted-foreground">Skickas dagen innan planerat besök</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                <div>
                  <span className="font-medium">Arbete slutfört</span>
                  <p className="text-sm text-muted-foreground">Skickas när tekniker markerar jobb som klart</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5" />
                <div>
                  <span className="font-medium">Bokning bekräftad</span>
                  <p className="text-sm text-muted-foreground">Skickas vid bekräftelse av självbokningar</p>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
