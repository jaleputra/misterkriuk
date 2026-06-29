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
  const partnerLines = tx.sale_category === "partner" && tx.partner_name ? 1 : 0;
  return Math.max(100, 77 + addressLines * 4 + partnerLines * 4 + tx.items.length * 10);
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
  if (tx.sale_category === "partner" && tx.partner_name) row("Partner", tx.partner_name);
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
  row("TOTAL", rupiah(tx.total), true);
  row("Bayar", tx.payment_method.toUpperCase());
  if (tx.payment_method === "cash") {
    row("Tunai", rupiah(tx.cash_received ?? 0));
    row("Kembalian", rupiah(tx.change_amount ?? 0));
  }
  divider();
  centerText(`Terima kasih ${tx.buyer_name ?? "Pelanggan"}`.trim());
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

export async function shareReceiptPdf(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings) {
  const { pdf, fileName } = createReceiptPdf(tx, settings);
  pdf.save(fileName);
  const customerInfo = tx.house_block ? `Blok ${tx.house_block}` : "Pelanggan";
  const message = encodeURIComponent(
    `Struk pembayaran ${settings?.shop_name ?? "AMI Fried Chicken"} untuk ${tx.buyer_name ?? customerInfo}. PDF struk sudah diunduh, silakan lampirkan file ${fileName}.`,
  );
  const whatsappWindow = window.open(`https://wa.me/?text=${message}`, "_blank");
  if (!whatsappWindow) throw new Error("Izinkan pop-up untuk membuka WhatsApp");
}

function buildReceiptText(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings): string {
  const shopName = settings?.shop_name ?? "AMI Fried Chicken";
  const shopAddress = settings?.shop_address ? `${settings.shop_address}\n` : "";
  const shopPhone = settings?.shop_phone ? `${settings.shop_phone}\n` : "";
  
  let text = `*${shopName.toUpperCase()}*\n`;
  if (shopAddress) text += `${shopAddress}`;
  if (shopPhone) text += `${shopPhone}`;
  text += `--------------------------------\n`;
  text += `No: ${tx.id.slice(0, 8).toUpperCase()}\n`;
  text += `Tanggal: ${new Date(tx.created_at).toLocaleString("id-ID")}\n`;
  if (tx.sale_category === "partner" && tx.partner_name) {
    text += `Partner: ${tx.partner_name}\n`;
  }
  text += `--------------------------------\n`;
  
  tx.items.forEach((item) => {
    text += `*${item.product_name}*\n`;
    text += `  ${item.quantity} x ${rupiah(item.price)} = ${rupiah(item.subtotal)}\n`;
  });
  
  text += `--------------------------------\n`;
  text += `*TOTAL: ${rupiah(tx.total)}*\n`;
  text += `Bayar: ${tx.payment_method.toUpperCase()}\n`;
  if (tx.payment_method === "cash") {
    text += `Tunai: ${rupiah(tx.cash_received ?? 0)}\n`;
    text += `Kembalian: ${rupiah(tx.change_amount ?? 0)}\n`;
  }
  text += `--------------------------------\n`;
  text += `Terima kasih ${tx.buyer_name ?? "Pelanggan"}\n`;
  if (tx.house_block) {
    text += `*BLOK: ${tx.house_block.toUpperCase()}*\n`;
  }
  return text;
}

export async function shareReceiptImage(tx: ReceiptPdfTransaction, settings: ReceiptPdfSettings) {
  const element = document.getElementById("receipt-print");
  if (!element) {
    throw new Error("Elemen struk tidak ditemukan");
  }

  // Simpan style asli
  const originalStyle = element.getAttribute("style") || "";
  
  // Modifikasi style agar rapi saat dicapture (pastikan background putih, teks hitam, dan tanpa border)
  element.setAttribute(
    "style",
    originalStyle +
      "; background-color: #ffffff; color: #000000; padding: 16px; border: none; border-radius: 0;"
  );

  try {
    const canvas = await html2canvas(element, {
      scale: 2, // Tingkatkan resolusi agar teks tajam
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });

    // Kembalikan style asli
    element.setAttribute("style", originalStyle);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("Gagal membuat file gambar struk");
    }

    const fileName = `struk-${tx.id.slice(0, 8).toUpperCase()}.png`;
    
    // Coba salin gambar ke clipboard agar kasir bisa langsung Paste (Ctrl+V) di chat WhatsApp
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({
            [blob.type]: blob,
          }),
        ]);
        toast.success("Gambar struk disalin ke clipboard! Silakan paste di WhatsApp.");
      }
    } catch (clipErr) {
      console.log("Clipboard copy not supported or failed", clipErr);
    }

    // Unduh gambar struk otomatis
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Otomatis buka WhatsApp dengan rincian struk lengkap dalam bentuk teks
    const receiptText = buildReceiptText(tx, settings);
    const whatsappText = encodeURIComponent(receiptText);
    const whatsappUrl = `https://wa.me/?text=${whatsappText}`;
    const whatsappWindow = window.open(whatsappUrl, "_blank");
    if (!whatsappWindow) {
      toast.success("Gambar struk diunduh");
      throw new Error("Izinkan pop-up untuk membuka WhatsApp secara otomatis");
    }
  } catch (err) {
    element.setAttribute("style", originalStyle);
    throw err;
  }
}
