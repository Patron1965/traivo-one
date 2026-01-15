import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { format } from 'date-fns';
import { sv } from 'date-fns/locale';
import {
  Protocol,
  PROTOCOL_TYPE_LABELS,
  ExecutedAction,
  type WorkOrder,
  type ServiceObject,
  type Customer,
  type Tenant,
} from '@shared/schema';

interface ProtocolContext {
  workOrder?: WorkOrder | null;
  object?: ServiceObject | null;
  customer?: Customer | null;
  tenant?: Tenant | null;
}

export async function generateProtocolPdf(
  protocol: Protocol,
  context: ProtocolContext
): Promise<Buffer> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  let y = margin;

  // Colors
  const primaryColor: [number, number, number] = [41, 98, 255]; // #2962ff
  const textColor: [number, number, number] = [33, 33, 33];
  const lightGray: [number, number, number] = [245, 245, 245];

  // Helper function to add text with wrapping
  const addWrappedText = (text: string, x: number, maxWidth: number, fontSize: number = 10): number => {
    doc.setFontSize(fontSize);
    const lines = doc.splitTextToSize(text, maxWidth);
    doc.text(lines, x, y);
    return lines.length * (fontSize * 0.4);
  };

  // Header
  doc.setFillColor(...primaryColor);
  doc.rect(0, 0, pageWidth, 35, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  
  const protocolTypeLabel = PROTOCOL_TYPE_LABELS[protocol.protocolType as keyof typeof PROTOCOL_TYPE_LABELS] || protocol.protocolType;
  doc.text(protocolTypeLabel, margin, 20);
  
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`Protokollnummer: ${protocol.protocolNumber || protocol.id.substring(0, 8)}`, margin, 28);
  
  // Company name on right
  if (context.tenant?.name) {
    doc.setFontSize(12);
    doc.text(context.tenant.name, pageWidth - margin, 20, { align: 'right' });
  }

  y = 50;

  // Reset text color
  doc.setTextColor(...textColor);

  // Info box
  doc.setFillColor(...lightGray);
  doc.roundedRect(margin, y, pageWidth - 2 * margin, 40, 3, 3, 'F');
  
  y += 8;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  
  // Left column
  doc.text('Kund:', margin + 5, y);
  doc.setFont('helvetica', 'normal');
  doc.text(context.customer?.name || '-', margin + 30, y);
  
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Objekt:', margin + 5, y);
  doc.setFont('helvetica', 'normal');
  doc.text(context.object?.name || '-', margin + 30, y);
  
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Adress:', margin + 5, y);
  doc.setFont('helvetica', 'normal');
  doc.text(context.object?.address || '-', margin + 30, y);
  
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Datum:', margin + 5, y);
  doc.setFont('helvetica', 'normal');
  doc.text(
    protocol.executedAt 
      ? format(new Date(protocol.executedAt), 'PPP HH:mm', { locale: sv })
      : '-',
    margin + 30,
    y
  );

  // Right column
  const rightX = pageWidth / 2 + 10;
  y = 50 + 8;
  
  doc.setFont('helvetica', 'bold');
  doc.text('Utfört av:', rightX, y);
  doc.setFont('helvetica', 'normal');
  doc.text(protocol.executedByName || '-', rightX + 25, y);
  
  y += 7;
  doc.setFont('helvetica', 'bold');
  doc.text('Total tid:', rightX, y);
  doc.setFont('helvetica', 'normal');
  doc.text(
    protocol.totalDurationMinutes 
      ? `${Math.floor(protocol.totalDurationMinutes / 60)}h ${protocol.totalDurationMinutes % 60}min`
      : '-',
    rightX + 25,
    y
  );

  y = 100;

  // Work description
  if (protocol.workDescription) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Beskrivning av utfört arbete', margin, y);
    y += 8;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    const descHeight = addWrappedText(protocol.workDescription, margin, pageWidth - 2 * margin);
    y += descHeight + 10;
  }

  // Executed actions table
  const executedActions = protocol.executedActions as ExecutedAction[] || [];
  if (executedActions.length > 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Utförda åtgärder', margin, y);
    y += 5;

    const tableData = executedActions.map((action) => [
      action.articleName || action.stepName || '-',
      String(action.quantity),
      `${action.durationMinutes} min`,
      action.status === 'completed' ? 'Utfört' : 
        action.status === 'skipped' ? 'Hoppades över' : 'Ej tillämpligt',
      action.notes || '',
    ]);

    (doc as any).autoTable({
      startY: y,
      head: [['Åtgärd', 'Antal', 'Tid', 'Status', 'Anteckningar']],
      body: tableData,
      theme: 'striped',
      headStyles: {
        fillColor: primaryColor,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      styles: {
        fontSize: 9,
        cellPadding: 3,
      },
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 20, halign: 'center' },
        2: { cellWidth: 25, halign: 'center' },
        3: { cellWidth: 30, halign: 'center' },
        4: { cellWidth: 40 },
      },
      margin: { left: margin, right: margin },
    });

    y = (doc as any).lastAutoTable.finalY + 15;
  }

  // Assessment (for inspections)
  if (protocol.assessmentRating) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Bedömning', margin, y);
    y += 8;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    const ratingLabels: Record<string, string> = {
      'lite_skrapigt': 'Lite skräpigt',
      'skrapigt': 'Skräpigt',
      'mycket_skrapigt': 'Mycket skräpigt',
      'rent': 'Rent',
      'ok': 'OK',
      'behover_atgard': 'Behöver åtgärd',
    };
    
    doc.text(`Resultat: ${ratingLabels[protocol.assessmentRating] || protocol.assessmentRating}`, margin, y);
    y += 6;
    
    if (protocol.assessmentNotes) {
      y += addWrappedText(`Kommentar: ${protocol.assessmentNotes}`, margin, pageWidth - 2 * margin);
      y += 10;
    }
  }

  // Signature section
  if (protocol.signature || protocol.signedAt) {
    // Check if we need a new page
    if (y > pageHeight - 60) {
      doc.addPage();
      y = margin;
    }
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Signatur', margin, y);
    y += 10;
    
    // Draw signature box
    doc.setDrawColor(200, 200, 200);
    doc.rect(margin, y, 80, 30);
    
    // If signature is base64 image, try to add it
    if (protocol.signature && protocol.signature.startsWith('data:image')) {
      try {
        doc.addImage(protocol.signature, 'PNG', margin + 2, y + 2, 76, 26);
      } catch (e) {
        doc.setFontSize(9);
        doc.text('Signatur bifogad', margin + 5, y + 15);
      }
    }
    
    y += 35;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    if (protocol.signedAt) {
      doc.text(`Signerad: ${format(new Date(protocol.signedAt), 'PPP HH:mm', { locale: sv })}`, margin, y);
    }
  }

  // Footer
  const footerY = pageHeight - 15;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text(
    `Genererad: ${format(new Date(), 'PPP HH:mm', { locale: sv })}`,
    margin,
    footerY
  );
  doc.text(
    `Sida 1 av 1`,
    pageWidth - margin,
    footerY,
    { align: 'right' }
  );

  // Return as buffer
  const pdfOutput = doc.output('arraybuffer');
  return Buffer.from(pdfOutput);
}

export function generateProtocolNumber(protocolType: string, date: Date): string {
  const typePrefix = {
    cleaning: 'ST',
    inspection: 'BE',
    maintenance: 'UH',
    container_wash: 'TT',
    annual_service: 'AS',
  }[protocolType] || 'PR';
  
  const dateStr = format(date, 'yyyyMMdd');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  
  return `${typePrefix}-${dateStr}-${random}`;
}
