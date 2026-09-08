export const rupiah = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v).replace(/\s+/g, " ");
};

/**
 * Membersihkan alamat toko untuk struk pembayaran, menghapus teks koordinat GPS,
 * radius, dan format JSON teknis sehingga hanya menampilkan alamat fisik yang rapi.
 */
export function cleanReceiptAddress(raw?: string | null): string {
  if (!raw) return "";
  let text = String(raw).trim();
  if (!text) return "";

  // 1. Jika dalam format JSON string e.g. {"addr":"Jl. ...","lat":-6.2088,"lng":106.8456,"radius":150}
  if (text.startsWith("{") && text.endsWith("}")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        text = String(parsed.addr || parsed.address || "").trim();
      }
    } catch {
      // fallback ke regex ekstraksi
      const match = text.match(/"addr"\s*:\s*"([^"]+)"/i) || text.match(/"address"\s*:\s*"([^"]+)"/i);
      if (match && match[1]) {
        text = match[1].trim();
      }
    }
  }

  // 2. Hapus sisa-sisa pola koordinat atau format teknis jika ada
  text = text
    .replace(/\{"addr":\s*"?([^",}]+)"?[^}]*\}/gi, "$1")
    .replace(/(?:titik\s+)?ko?rdinat[:\s]*[-0-9.,\s]+/gi, "")
    .replace(/lat(?:itude)?[:\s]*[-0-9.]+/gi, "")
    .replace(/l(?:n|on)g(?:itude)?[:\s]*[-0-9.]+/gi, "")
    .replace(/radius(?:_meters)?[:\s]*\d+\s*m?/gi, "")
    .replace(/[-0-9.]+\s*,\s*[-0-9.]+/g, (match) => {
      const parts = match.split(",").map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        if (parts[0] >= -90 && parts[0] <= 90 && parts[1] >= -180 && parts[1] <= 180) {
          return "";
        }
      }
      return match;
    })
    .replace(/,\s*,/g, ",")
    .replace(/\s+/g, " ")
    .replace(/^[,\s.-]+|[,\s.-]+$/g, "")
    .trim();

  // Jika teks hasil pembersihan masih mengandung format JSON teknis
  if (text.startsWith("{") || text.includes('"lat"') || text.includes('"lng"')) {
    return "";
  }

  return text;
}

