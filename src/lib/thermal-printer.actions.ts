import { createClientOnlyFn } from "@tanstack/react-start";
import {
  connectPrinter,
  disconnectPrinter,
  isBluetoothSupported,
  isPrinterConnected,
  printReceiptThermal,
  subscribePrinter,
  testPrint,
} from "@/lib/thermal-printer.client";

export const connectPrinterClient = createClientOnlyFn(connectPrinter);
export const disconnectPrinterClient = createClientOnlyFn(disconnectPrinter);
export const isBluetoothSupportedClient = createClientOnlyFn(isBluetoothSupported);
export const isPrinterConnectedClient = createClientOnlyFn(isPrinterConnected);
export const printReceiptThermalClient = createClientOnlyFn(printReceiptThermal);
export const subscribePrinterClient = createClientOnlyFn(subscribePrinter);
export const testPrintClient = createClientOnlyFn(testPrint);
