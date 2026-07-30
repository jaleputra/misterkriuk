// Bluetooth thermal printer (ESC/POS) client.
// Supports common generic BT thermal printers exposing the Nordic-like
// service 000018f0-0000-1000-8000-00805f9b34fb with write characteristic
// 00002af1-0000-1000-8000-00805f9b34fb. Falls back by scanning writable
// characteristics on the primary service if the well-known UUID is missing.

import { rupiah } from "@/lib/format";

const SERVICE_UUID = "000018f0-0000-1000-8000-00805f9b34fb";
const CHAR_UUID = "00002af1-0000-1000-8000-00805f9b34fb";

type BTDevice = {
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<unknown>;
    disconnect: () => void;
    getPrimaryService: (uuid: string) => Promise<BTService>;
    getPrimaryServices: () => Promise<BTService[]>;
  };
  addEventListener: (type: string, listener: () => void) => void;
};
type BTService = {
  getCharacteristic: (uuid: string) => Promise<BTCharacteristic>;
  getCharacteristics: () => Promise<BTCharacteristic[]>;
};
type BTCharacteristic = {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValue: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
};

type State = {
  device: BTDevice | null;
  characteristic: BTCharacteristic | null;
  listeners: Set<() => void>;
};

const state: State = { device: null, characteristic: null, listeners: new Set() };

function notify() {
  state.listeners.forEach((l) => l());
}

export function subscribePrinter(listener: () => void) {
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

export function isPrinterConnected() {
  return !!state.device?.gatt?.connected && !!state.characteristic;
}

export function getPrinterName() {
  return state.device?.name ?? null;
}

export function isBluetoothSupported() {
  return (
    typeof navigator !== "undefined" &&
    !!(navigator as unknown as { bluetooth?: unknown }).bluetooth
  );
}

async function pickWritableCharacteristic(device: BTDevice): Promise<BTCharacteristic> {
  if (!device.gatt) throw new Error("Perangkat tidak mendukung GATT");
  try {
    const svc = await device.gatt.getPrimaryService(SERVICE_UUID);
    try {
      const ch = await svc.getCharacteristic(CHAR_UUID);
      return ch;
    } catch {
      const chars = await svc.getCharacteristics();
      const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
      if (w) return w;
    }
  } catch {
    // fall back to scanning all services
  }
  const services = await device.gatt.getPrimaryServices();
  for (const svc of services) {
    const chars = await svc.getCharacteristics();
    const w = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
    if (w) return w;
  }
  throw new Error("Karakteristik printer tidak ditemukan");
}

export async function connectPrinter(): Promise<{ name: string }> {
  const nav = navigator as unknown as {
    bluetooth?: {
      requestDevice: (opts: {
        acceptAllDevices?: boolean;
        optionalServices?: string[];
      }) => Promise<BTDevice>;
    };
  };
  if (!nav.bluetooth) throw new Error("Browser tidak mendukung Web Bluetooth");
  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      SERVICE_UUID,
      "0000ff00-0000-1000-8000-00805f9b34fb",
      "00001101-0000-1000-8000-00805f9b34fb",
    ],
  });
  if (!device.gatt) throw new Error("Perangkat tidak mendukung GATT");
  await device.gatt.connect();
  const ch = await pickWritableCharacteristic(device);
  state.device = device;
  state.characteristic = ch;
  device.addEventListener("gattserverdisconnected", () => {
    state.characteristic = null;
    notify();
  });
  notify();
  return { name: device.name ?? "Thermal Printer" };
}

export function disconnectPrinter() {
  try {
    state.device?.gatt?.disconnect();
  } catch {
    // ignore
  }
  state.device = null;
  state.characteristic = null;
  notify();
}

async function writeChunks(bytes: Uint8Array) {
  const ch = state.characteristic;
  if (!ch) throw new Error("Printer tidak terhubung");
  const CHUNK = 180;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.slice(i, i + CHUNK);
    if (ch.writeValueWithoutResponse && ch.properties.writeWithoutResponse) {
      await ch.writeValueWithoutResponse(slice);
    } else {
      await ch.writeValue(slice);
    }
  }
}

// ESC/POS builder
const ESC = 0x1b;
const GS = 0x1d;
const enc = new TextEncoder();

function concat(parts: Array<Uint8Array | number[]>) {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

const cmd = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0],
  alignCenter: [ESC, 0x61, 1],
  boldOn: [ESC, 0x45, 1],
  boldOff: [ESC, 0x45, 0],
  doubleOn: [GS, 0x21, 0x11],
  doubleOff: [GS, 0x21, 0x00],
  feed: (n: number) => [ESC, 0x64, n],
  cut: [GS, 0x56, 0x42, 0x00],
};

function lineBetween(left: string, right: string, width: number) {
  const space = Math.max(1, width - left.length - right.length);
  return left + " ".repeat(space) + right;
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let s = text;
  while (s.length > width) {
    lines.push(s.slice(0, width));
    s = s.slice(width);
  }
  if (s.length) lines.push(s);
  return lines;
}

type ReceiptTx = {
  id: string;
  created_at: string;
  total: number | string;
  discount_amount?: number | string | null;
  payment_method: string;
  cash_received: number | string | null;
  change_amount: number | string | null;
  sale_category?: string;
  partner_name?: string | null;
  buyer_name?: string | null;
  house_block?: string | null;
  items: { product_name: string; price: number; quantity: number; subtotal: number }[];
};
type ReceiptSettings = {
  shop_name?: string | null;
  shop_address?: string | null;
  shop_phone?: string | null;
  paper_width?: number | null;
} | null;

function buildReceipt(tx: ReceiptTx, settings: ReceiptSettings): Uint8Array {
  const width = (settings?.paper_width ?? 58) >= 80 ? 42 : 32;
  const parts: Array<Uint8Array | number[]> = [];
  parts.push(cmd.init);
  parts.push(cmd.alignCenter);
  parts.push(cmd.boldOn, cmd.doubleOn);
  parts.push(enc.encode((settings?.shop_name ?? "AMI Fried Chicken") + "\n"));
  parts.push(cmd.doubleOff, cmd.boldOff);
  if (settings?.shop_address)
    for (const l of wrap(settings.shop_address, width)) parts.push(enc.encode(l + "\n"));
  if (settings?.shop_phone) parts.push(enc.encode(settings.shop_phone + "\n"));
  parts.push(cmd.alignLeft);
  parts.push(enc.encode("-".repeat(width) + "\n"));
  parts.push(enc.encode(lineBetween("No.", tx.id.slice(0, 8).toUpperCase(), width) + "\n"));
  parts.push(
    enc.encode(
      lineBetween("Tanggal", new Date(tx.created_at).toLocaleString("id-ID"), width) + "\n",
    ),
  );
  if (tx.partner_name)
    parts.push(enc.encode(lineBetween("Partner", tx.partner_name, width) + "\n"));
  parts.push(enc.encode("-".repeat(width) + "\n"));

  for (const it of tx.items) {
    for (const l of wrap(it.product_name, width)) parts.push(enc.encode(l + "\n"));
    parts.push(
      enc.encode(
        lineBetween(`${it.quantity} x ${rupiah(it.price)}`, rupiah(it.subtotal), width) + "\n",
      ),
    );
  }
  parts.push(enc.encode("-".repeat(width) + "\n"));
  if (tx.discount_amount && Number(tx.discount_amount) > 0) {
    parts.push(enc.encode(lineBetween("Diskon", `-${rupiah(tx.discount_amount)}`, width) + "\n"));
  }
  parts.push(cmd.boldOn);
  parts.push(enc.encode(lineBetween("TOTAL", rupiah(tx.total), width) + "\n"));
  parts.push(cmd.boldOff);
  parts.push(enc.encode(lineBetween("Bayar", tx.payment_method.toUpperCase(), width) + "\n"));
  if (tx.payment_method === "cash") {
    parts.push(enc.encode(lineBetween("Tunai", rupiah(tx.cash_received ?? 0), width) + "\n"));
    parts.push(enc.encode(lineBetween("Kembalian", rupiah(tx.change_amount ?? 0), width) + "\n"));
  }
  parts.push(enc.encode("-".repeat(width) + "\n"));
  parts.push(cmd.alignCenter);
  const thanks = `Terima kasih ${tx.partner_name || tx.buyer_name || "Pelanggan"}`;
  for (const l of wrap(thanks, width)) parts.push(enc.encode(l + "\n"));
  parts.push(enc.encode("\n"));
  const promo =
    "Terima pesanan acara ulang tahun, arisan dan lainnya. Kirim juga kritik dan saran anda ke No Whatsapp 082281384529. Kepuasan anda adalah prioritas kami.";
  for (const l of wrap(promo, width)) parts.push(enc.encode(l + "\n"));
  if (tx.house_block) {
    parts.push(enc.encode("\n"));
    parts.push(cmd.boldOn, cmd.doubleOn);
    parts.push(enc.encode(`BLOK: ${tx.house_block.toUpperCase()}\n`));
    parts.push(cmd.doubleOff, cmd.boldOff);
  }
  parts.push(cmd.feed(1));
  parts.push(cmd.cut);
  return concat(parts);
}

export async function printReceiptThermal(tx: ReceiptTx, settings: ReceiptSettings) {
  if (!isPrinterConnected()) throw new Error("Printer belum terhubung");
  await writeChunks(buildReceipt(tx, settings));
}

export async function testPrint(settings: ReceiptSettings) {
  if (!isPrinterConnected()) throw new Error("Printer belum terhubung");
  const width = (settings?.paper_width ?? 58) >= 80 ? 42 : 32;
  const parts: Array<Uint8Array | number[]> = [];
  parts.push(cmd.init, cmd.alignCenter, cmd.boldOn, cmd.doubleOn);
  parts.push(enc.encode("TEST PRINT\n"));
  parts.push(cmd.doubleOff, cmd.boldOff);
  parts.push(enc.encode((settings?.shop_name ?? "AMI Fried Chicken") + "\n"));
  parts.push(cmd.alignLeft);
  parts.push(enc.encode("-".repeat(width) + "\n"));
  parts.push(enc.encode("Printer terhubung dengan baik.\n"));
  parts.push(enc.encode(new Date().toLocaleString("id-ID") + "\n"));
  parts.push(cmd.feed(3), cmd.cut);
  await writeChunks(concat(parts));
}
