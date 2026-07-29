import { jsPDF } from "jspdf";
import { rupiah } from "@/lib/format";
import type { ReceiptPdfSettings, ReceiptPdfTransaction } from "@/lib/receipt-pdf.types";
import html2canvas from "html2canvas";
import { toast } from "sonner";

export type { ReceiptPdfSettings, ReceiptPdfTransaction };

const RECEIPT_WIDTH_MM = 80;
const CONTENT_WIDTH_MM = 72;
const LEFT_MM = 4;

function receiptHeight(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings) {
  const addressLines = settings?.shop_address
    ? Math.max(1, Math.ceil(settings.shop_address.length / 40))
    : 0;
  const phoneLines = settings?.shop_phone ? 1 : 0;
  const partnerLines = tx.partner_name ? 1 : 0;
  const discountLines = Number(tx.discount_amount) > 0 ? 1 : 0;
  const cashLines = tx.payment_method === "cash" ? 2 : 0;

  let itemsHeight = 0;
  tx.items.forEach((item) => {
    const nameLines = Math.max(1, Math.ceil(item.product_name.length / 40));
    itemsHeight += nameLines * 4 + 5;
  });

  // Base height is 54. If block is present, we add 2mm (blockHeight) instead of 6mm
  // to make the bottom margin tighter for the block text (~3mm margin).
  // If block is not present, it has a safe ~7mm bottom margin to avoid text cutoff.
  const blockHeight = tx.house_block ? 2 : 0;

  return 54 + addressLines * 4 + phoneLines * 4 + partnerLines * 4 + discountLines * 4 + cashLines * 4 + blockHeight + itemsHeight;
}

function safeFileName(tx: ReceiptPdfTransaction) {
  return `struk-${tx.id.slice(0, 8).toUpperCase()}.pdf`;
}

export function createReceiptPdf(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: [RECEIPT_WIDTH_MM, receiptHeight(tx, settings)],
    compress: true,
  });
  let y = 7;
  const center = RECEIPT_WIDTH_MM / 2;
  const right = RECEIPT_WIDTH_MM - LEFT_MM;

  const centerText = (text: string, size = 8, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(text, CONTENT_WIDTH_MM) as string[];
    pdf.text(lines, center, y, { align: "center" });
    y += lines.length * 4;
  };
  const row = (left: string, rightText: string, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(8);
    pdf.text(left, LEFT_MM, y);
    pdf.text(rightText, right, y, { align: "right" });
    y += 4;
  };
  const divider = () => {
    pdf.setLineDashPattern([1, 1], 0);
    pdf.line(LEFT_MM, y, right, y);
    y += 4;
  };

  centerText(settings?.shop_name ?? "AMI Fried Chicken", 10, true);
  if (settings?.shop_address) centerText(settings.shop_address);
  if (settings?.shop_phone) centerText(settings.shop_phone);
  divider();
  row("No.", tx.id.slice(0, 8).toUpperCase());
  row("Tanggal", new Date(tx.created_at).toLocaleString("id-ID"));
  if (tx.partner_name) row("Partner", tx.partner_name);
  divider();

  tx.items.forEach((item) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const nameLines = pdf.splitTextToSize(item.product_name, CONTENT_WIDTH_MM) as string[];
    pdf.text(nameLines, LEFT_MM, y);
    y += nameLines.length * 4;
    row(`${item.quantity} x ${rupiah(item.price)}`, rupiah(item.subtotal));
    y += 1;
  });

  divider();
  if (Number(tx.discount_amount) > 0) {
    row("Diskon", `-${rupiah(tx.discount_amount ?? 0)}`);
  }
  row("TOTAL", rupiah(tx.total), true);
  row("Bayar", tx.payment_method.toUpperCase());
  if (tx.payment_method === "cash") {
    row("Tunai", rupiah(tx.cash_received ?? 0));
    row("Kembalian", rupiah(tx.change_amount ?? 0));
  }
  divider();
  centerText(`Terima kasih ${tx.partner_name || tx.buyer_name || "Pelanggan"}`.trim());
  if (tx.house_block) {
    y += 2;
    centerText(`BLOK: ${tx.house_block.toUpperCase()}`, 11, true);
  }

  return { pdf, fileName: safeFileName(tx) };
}

export function printReceiptPdf(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings) {
  const { pdf } = createReceiptPdf(tx, settings);
  const url = URL.createObjectURL(pdf.output("blob"));
  const printWindow = window.open(url, "_blank");
  if (!printWindow) {
    URL.revokeObjectURL(url);
    throw new Error("Izinkan pop-up untuk mencetak struk PDF");
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function captureElementViaIframe(element: HTMLElement): Promise<HTMLCanvasElement> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("scrolling", "no");
  iframe.setAttribute("width", "500");
  iframe.setAttribute("height", "1500");
  iframe.style.position = "absolute";
  iframe.style.left = "0";
  iframe.style.top = "0";
  iframe.style.width = "500px";
  iframe.style.minWidth = "500px";
  iframe.style.height = "1500px"; // Make it tall initially to prevent clipping during rendering
  iframe.style.border = "none";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.zIndex = "-9999";
  document.body.appendChild(iframe);

  const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!iframeDoc) {
    throw new Error("Cannot access iframe document");
  }

  iframeDoc.open();
  iframeDoc.write(`
    <html>
      <head>
        <meta name="viewport" content="width=500, initial-scale=1">
        <style>
          html, body {
            width: 500px;
            margin: 0;
            padding: 0;
            background: white;
            color: black;
            font-family: Arial, sans-serif;
            overflow: hidden;
          }
          #receipt-capture-area {
            width: 310px;
            padding: 15px;
            background: white;
            box-sizing: border-box;
          }
          #receipt-print {
            width: 280px;
            padding: 16px 16px 4px 16px;
            background: white;
            border: 1px solid black;
            border-radius: 6px;
            font-size: 12px;
            box-sizing: border-box;
          }
          .center { text-align: center; }
          .text-center { text-align: center; }
          .font-bold { font-weight: bold; }
          .font-semibold { font-weight: 600; }
          .text-xs { font-size: 12px; }
          .text-sm { font-size: 14px; }
          .text-lg { font-size: 18px; }
          .mt-3 { margin-top: 12px; }
          .mb-1 { margin-bottom: 4px; }
          .my-2 { margin-top: 8px; margin-bottom: 8px; }
          .flex { display: flex; }
          .row { display: flex; }
          .justify-between { justify-content: space-between; }
          .flex-nowrap { flex-wrap: nowrap; }
          .shrink-0 { flex-shrink: 0; }
          .flex-1 { flex: 1 1 0%; }
          .min-w-0 { min-width: 0px; }
          .text-right { text-align: right; }
          .break-words { overflow-wrap: break-word; word-break: break-word; }
          .break-all { word-break: break-all; }
          .pl-2 { padding-left: 8px; }
          .font-mono { font-family: monospace; }
          .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          hr { border: none; border-top: 1px dashed black; margin: 8px 0; }
          .border { border: 1px solid black; }
          .p-1\\.5 { padding: 6px; }
          .rounded { border-radius: 4px; }
          .bg-black\\/5 { background-color: rgba(0, 0, 0, 0.05); }
        </style>
      </head>
      <body>
        <div id="receipt-capture-area">
          <div id="receipt-print">
            ${element.innerHTML}
          </div>
        </div>
      </body>
    </html>
  `);
  iframeDoc.close();

  // Tunggu agar iframe selesai me-render
  await new Promise((resolve) => setTimeout(resolve, 150));

  const target = iframeDoc.getElementById("receipt-capture-area");
  if (!target) {
    document.body.removeChild(iframe);
    throw new Error("Target inside iframe not found");
  }

  // Adjust iframe height dynamically based on target's scroll height
  iframe.style.height = (target.scrollHeight + 50) + "px";
  iframe.setAttribute("height", String(target.scrollHeight + 50));

  const canvas = await html2canvas(target, {
    scale: 2.5,
    backgroundColor: "#ffffff",
    logging: false,
    useCORS: true,
    width: 310,
    height: target.scrollHeight,
    windowWidth: 500,
    windowHeight: target.scrollHeight + 100,
  });

  document.body.removeChild(iframe);
  return canvas;
}

export async function shareReceiptPdf(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings) {
  const { pdf, fileName } = createReceiptPdf(tx, settings);
  const blob = pdf.output("blob");
  const file = new File([blob], fileName, { type: "application/pdf" });

  const customerInfo = tx.house_block ? `Blok ${tx.house_block}` : "Pelanggan";
  const textMessage = `Struk pembayaran ${settings?.shop_name ?? "AMI Fried Chicken"} untuk ${tx.buyer_name ?? customerInfo}.`;

  // 1. Coba gunakan Web Share API untuk membagikan file PDF secara langsung (sangat berguna di perangkat mobile/Safari)
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: fileName,
        text: textMessage,
      });
      toast.success("Struk PDF berhasil dibagikan");
      return;
    } catch (shareErr) {
      if (shareErr instanceof Error && shareErr.name === "AbortError") {
        console.log("Sharing aborted by user");
        return;
      }
      console.error("Web Share failed, falling back to download and link", shareErr);
    }
  }

  // 2. Fallback untuk Desktop / Browser yang tidak mendukung sharing file PDF langsung:
  // a. Unduh file PDF secara otomatis
  try {
    pdf.save(fileName);
    toast.success("PDF Struk berhasil diunduh secara otomatis.");
  } catch (downloadErr) {
    console.error("Download failed", downloadErr);
  }

  // b. Capture gambar struk via Iframe (aman dari error Tailwind 'lab' color) dan salin ke clipboard
  let copiedToClipboard = false;
  try {
    const element = document.getElementById("receipt-print");
    if (element) {
      const canvas = await captureElementViaIframe(element);
      const imgBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (imgBlob && navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [imgBlob.type]: imgBlob,
          }),
        ]);
        copiedToClipboard = true;
        toast.success("Gambar struk disalin ke clipboard! Silakan paste (Ctrl+V) di WhatsApp.");
      }
    }
  } catch (err) {
    console.error("Gagal menyalin gambar struk ke clipboard", err);
  }

  // c. Buka WhatsApp Web dengan pesan berisi informasi struk
  const clipboardHint = copiedToClipboard 
    ? "Gambar struk sudah disalin ke clipboard, silakan Paste (Ctrl+V) di chat WhatsApp." 
    : `Silakan lampirkan file PDF ${fileName} yang telah diunduh.`;
  const message = encodeURIComponent(
    `${textMessage} ${clipboardHint}`
  );
  const whatsappUrl = `https://wa.me/?text=${message}`;
  const whatsappWindow = window.open(whatsappUrl, "_blank");
  if (!whatsappWindow) {
    throw new Error("Izinkan pop-up untuk membuka WhatsApp secara otomatis");
  }
}

export async function shareReceiptImage(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings) {
  // Delegasikan langsung ke shareReceiptPdf yang memproses penanganan hybrid (PDF / Image Clipboard Copy)
  await shareReceiptPdf(tx, settings);
}
