import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Printer, Share2 } from "lucide-react";
import { toast } from "sonner";
import type { ReceiptPdfSettings, ReceiptPdfTransaction } from "@/lib/receipt-pdf.types";
import { printReceiptPdfClient, shareReceiptImageClient } from "@/lib/receipt-pdf.actions";
import {
  isPrinterConnectedClient,
  printReceiptThermalClient,
  subscribePrinterClient,
} from "@/lib/thermal-printer.actions";

type Props = {
  tx: ReceiptPdfTransaction;
  settings: ReceiptPdfSettings;
};

export function ReceiptDialogFooter({ tx, settings }: Props) {
  const [printerConnected, setPrinterConnected] = useState(false);

  useEffect(() => {
    setPrinterConnected(isPrinterConnectedClient());
    return subscribePrinterClient(() => setPrinterConnected(isPrinterConnectedClient()));
  }, []);

  const handlePrint = async () => {
    try {
      if (isPrinterConnectedClient()) {
        await printReceiptThermalClient(tx, settings);
        toast.success("Struk dicetak");
      } else {
        printReceiptPdfClient(tx, settings);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Gagal mencetak");
    }
  };

  const handleShare = async () => {
    try {
      await shareReceiptImageClient(tx, settings);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tidak dapat membagikan struk");
    }
  };

  return (
    <>
      <Button variant="outline" className="flex-1" onClick={handlePrint}>
        <Printer className="h-4 w-4 mr-2" />
        Cetak Struk
      </Button>
      <Button
        className="flex-1 bg-success text-success-foreground hover:bg-success/90"
        onClick={handleShare}
      >
        <Share2 className="h-4 w-4 mr-2" />
        Bagikan Struk
      </Button>
    </>
  );
}
