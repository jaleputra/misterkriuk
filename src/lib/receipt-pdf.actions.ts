import { createClientOnlyFn } from "@tanstack/react-start";
import { printReceiptPdf, shareReceiptPdf } from "@/lib/receipt-pdf.client";

export const printReceiptPdfClient = createClientOnlyFn(printReceiptPdf);
export const shareReceiptPdfClient = createClientOnlyFn(shareReceiptPdf);
