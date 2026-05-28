import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  IMPORT_TEMPLATES,
  type ImportTemplateKey,
} from "@shared/import-templates";

interface Props {
  type: ImportTemplateKey;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg";
  label?: string;
}

export function DownloadTemplateButton({
  type,
  variant = "outline",
  size = "sm",
  label,
}: Props) {
  const tpl = IMPORT_TEMPLATES[type];
  const filename = `traivo-mall-${type}.xlsx`;
  return (
    <Button
      asChild
      variant={variant}
      size={size}
      data-testid={`button-download-template-${type}`}
    >
      <a href={`/api/import/template/${type}`} download={filename}>
        <Download className="h-4 w-4 mr-2" />
        {label ?? `Ladda ner mall (${tpl.title})`}
      </a>
    </Button>
  );
}
