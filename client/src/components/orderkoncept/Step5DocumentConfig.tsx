import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FileCheck, Mail, Globe, Smartphone, Printer } from "lucide-react";
import {
  DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS,
  DISTRIBUTION_CHANNELS, DISTRIBUTION_CHANNEL_LABELS,
  type DocumentType, type DistributionChannel
} from "@shared/schema";

interface DocConfig {
  documentType: DocumentType;
  enabled: boolean;
  showPrice: boolean;
  distributionChannels: DistributionChannel[];
  recipients: string[];
}

interface Step5Props {
  documents: DocConfig[];
  onUpdate: (documents: DocConfig[]) => void;
}

const CHANNEL_ICONS: Record<DistributionChannel, typeof Mail> = {
  email: Mail,
  portal: Globe,
  sms: Smartphone,
  print: Printer,
};

export default function Step5DocumentConfig({ documents, onUpdate }: Step5Props) {
  const updateDoc = (type: DocumentType, updates: Partial<DocConfig>) => {
    onUpdate(
      documents.map(d =>
        d.documentType === type ? { ...d, ...updates } : d
      )
    );
  };

  return (
    <div className="space-y-4" data-testid="step5-document-config">
      {DOCUMENT_TYPES.map(type => {
        const doc = documents.find(d => d.documentType === type) || {
          documentType: type,
          enabled: type === "invoice",
          showPrice: true,
          distributionChannels: ["email"] as DistributionChannel[],
          recipients: [],
        };

        return (
          <Card key={type} className={!doc.enabled ? "opacity-60" : ""}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <FileCheck className="h-4 w-4" />
                  {DOCUMENT_TYPE_LABELS[type]}
                </CardTitle>
                <Switch
                  checked={doc.enabled}
                  onCheckedChange={(v) => updateDoc(type, { enabled: v })}
                  data-testid={`switch-doc-${type}`}
                />
              </div>
            </CardHeader>
            {doc.enabled && (
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs font-medium mb-2 block">Distributionskanaler</Label>
                  <div className="flex flex-wrap gap-3">
                    {DISTRIBUTION_CHANNELS.map(channel => {
                      const Icon = CHANNEL_ICONS[channel];
                      return (
                        <div key={channel} className="flex items-center space-x-1.5">
                          <Checkbox
                            checked={doc.distributionChannels.includes(channel)}
                            onCheckedChange={(checked) => {
                              updateDoc(type, {
                                distributionChannels: checked
                                  ? [...doc.distributionChannels, channel]
                                  : doc.distributionChannels.filter(c => c !== channel)
                              });
                            }}
                            id={`channel-${type}-${channel}`}
                            data-testid={`checkbox-channel-${type}-${channel}`}
                          />
                          <Label htmlFor={`channel-${type}-${channel}`} className="cursor-pointer text-sm flex items-center gap-1">
                            <Icon className="h-3.5 w-3.5" />
                            {DISTRIBUTION_CHANNEL_LABELS[channel]}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <Checkbox
                    checked={doc.showPrice}
                    onCheckedChange={(v) => updateDoc(type, { showPrice: !!v })}
                    id={`show-price-${type}`}
                    data-testid={`checkbox-show-price-${type}`}
                  />
                  <Label htmlFor={`show-price-${type}`} className="cursor-pointer text-sm">
                    Visa priser
                  </Label>
                </div>

                {doc.distributionChannels.includes("email") && (
                  <div>
                    <Label className="text-xs font-medium mb-1 block">E-postmottagare</Label>
                    <Input
                      placeholder="ekonomi@foretag.se"
                      value={doc.recipients.join(", ")}
                      onChange={(e) => updateDoc(type, {
                        recipients: e.target.value.split(",").map(s => s.trim()).filter(Boolean)
                      })}
                      data-testid={`input-recipients-${type}`}
                    />
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
