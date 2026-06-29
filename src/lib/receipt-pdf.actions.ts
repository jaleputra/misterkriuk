import { createClientOnlyFn } from "@tanstack/react-start";
import { printReceiptPdf, shareReceiptPdf, shareReceiptImage } from "@/lib/receipt-pdf.client";

export const printReceiptPdfClient = createClientOnlyFn(printReceiptPdf);
export const shareReceiptPdfClient = createClientOnlyFn(shareReceiptPdf);
export const shareReceiptImageClient = createClientOnlyFn(shareReceiptImage);
