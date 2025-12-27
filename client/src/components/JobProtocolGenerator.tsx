import { jsPDF } from "jspdf";
import "jspdf-autotable";
import { format } from "date-fns";
import { sv } from "date-fns/locale";

interface MaterialItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
}

interface JobProtocolData {
  workOrderId: string;
  title: string;
  objectName?: string;
  objectAddress?: string;
  customerName?: string;
  scheduledDate?: string;
  startTime?: string;
  endTime?: string;
  actualDuration?: number;
  technicianName?: string;
  photos?: string[];
  signaturePath?: string;
  notes?: string;
  status: string;
  materials?: MaterialItem[];
}

export async function generateJobProtocol(data: JobProtocolData): Promise<Blob> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text("Jobbprotokoll", pageWidth / 2, 20, { align: "center" });
  
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Order: ${data.workOrderId.slice(0, 8)}`, pageWidth / 2, 28, { align: "center" });
  doc.text(`Genererad: ${format(new Date(), "yyyy-MM-dd HH:mm", { locale: sv })}`, pageWidth / 2, 33, { align: "center" });

  doc.setDrawColor(200);
  doc.line(20, 38, pageWidth - 20, 38);

  let y = 48;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("Jobbinformation", 20, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");

  const infoRows = [
    ["Uppdrag:", data.title],
    ["Objekt:", data.objectName || "-"],
    ["Adress:", data.objectAddress || "-"],
    ["Kund:", data.customerName || "-"],
    ["Planerat datum:", data.scheduledDate ? format(new Date(data.scheduledDate), "d MMMM yyyy", { locale: sv }) : "-"],
    ["Status:", translateStatus(data.status)],
  ];

  if (data.technicianName) {
    infoRows.push(["Tekniker:", data.technicianName]);
  }

  if (data.actualDuration) {
    infoRows.push(["Arbetstid:", `${data.actualDuration} minuter`]);
  }

  infoRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, 20, y);
    doc.setFont("helvetica", "normal");
    doc.text(value || "-", 60, y);
    y += 6;
  });

  y += 10;

  if (data.notes) {
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Anteckningar", 20, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    const splitNotes = doc.splitTextToSize(data.notes, pageWidth - 40);
    doc.text(splitNotes, 20, y);
    y += splitNotes.length * 5 + 10;
  }

  if (data.materials && data.materials.length > 0) {
    if (y > 200) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Materialrapport", 20, y);
    y += 8;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    data.materials.forEach((item) => {
      doc.text(`- ${item.name}: ${item.quantity} ${item.unit}`, 25, y);
      y += 5;
    });
    y += 5;
  }

  if (data.photos && data.photos.length > 0) {
    if (y > 200) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Fotodokumentation", 20, y);
    y += 10;

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`${data.photos.length} foto(n) bifogade`, 20, y);
    y += 10;
  }

  if (data.signaturePath) {
    if (y > 220) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Kundsignatur", 20, y);
    y += 10;

    try {
      const signatureImg = await loadImageAsBase64(data.signaturePath);
      if (signatureImg) {
        doc.addImage(signatureImg, "PNG", 20, y, 80, 30);
        y += 35;
      }
    } catch (error) {
      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.text("Signatur registrerad (kunde ej laddas)", 20, y);
      y += 10;
    }

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(`Signerad: ${format(new Date(), "yyyy-MM-dd HH:mm", { locale: sv })}`, 20, y);
  }

  const footerY = doc.internal.pageSize.getHeight() - 15;
  doc.setFontSize(8);
  doc.setTextColor(128);
  doc.text("Genererad av Unicorn Field Service", pageWidth / 2, footerY, { align: "center" });

  return doc.output("blob");
}

async function loadImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function translateStatus(status: string): string {
  const statusMap: Record<string, string> = {
    created: "Skapad",
    scheduled: "Schemalagd",
    in_progress: "Pågår",
    completed: "Slutförd",
    cancelled: "Avbruten",
    skapad: "Skapad",
    planerad_pre: "Pre-planerad",
    planerad_resurs: "Resursplanerad",
    planerad_las: "Låst",
    utford: "Utförd",
    fakturerad: "Fakturerad",
  };
  return statusMap[status] || status;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
