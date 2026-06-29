/**
 * QRIS static-to-dynamic converter (EMVCo specification).
 * Parses static QRIS payload, inserts/replaces Tag 54 (amount),
 * and recalculates the CRC16 checksum at Tag 63.
 * Sorts all tags in ascending order to prevent failures in strict payment apps.
 */

export function generateDynamicQris(staticQris: string, amount: number): string {
  if (!staticQris) return "";

  let qris = staticQris.trim();
  if (qris.length < 8) return staticQris;

  // Remove the old CRC16 (last 4 characters after "6304")
  qris = qris.slice(0, -4);

  // Parse all tags
  const tags: { tag: string; lenVal: string; val: string }[] = [];
  let idx = 0;
  while (idx < qris.length) {
    const tag = qris.slice(idx, idx + 2);
    const lenVal = qris.slice(idx + 2, idx + 4);
    const len = parseInt(lenVal, 10);
    const val = qris.slice(idx + 4, idx + 4 + len);

    if (isNaN(len)) {
      break;
    }

    // Skip Tag 54 (amount) and Tag 63 (CRC) because we will generate/replace them
    if (tag !== "54" && tag !== "63") {
      tags.push({ tag, lenVal, val });
    }
    idx += 4 + len;
  }

  // Build new tag 54 (amount)
  const amtStr = Math.round(amount).toString();
  const amtLenVal = amtStr.length.toString().padStart(2, "0");
  tags.push({ tag: "54", lenVal: amtLenVal, val: amtStr });

  // Sort tags by tag number (ascending order is critical for strict apps like BCA/ShopeePay)
  tags.sort((a, b) => parseInt(a.tag, 10) - parseInt(b.tag, 10));

  // Rebuild the QRIS payload
  let newQris = "";
  for (const t of tags) {
    newQris += t.tag + t.lenVal + t.val;
  }

  // Append tag 6304
  newQris += "6304";

  // Calculate CRC16 CCITT (false)
  const crc = crc16(newQris);
  const crcHex = crc.toString(16).toUpperCase().padStart(4, "0");

  return newQris + crcHex;
}

/**
 * Calculates CRC-16 CCITT (false) checksum.
 * Polynomial: 0x1021, Initial: 0xFFFF, no post-XOR.
 */
function crc16(str: string): number {
  let crc = 0xffff;
  for (let c = 0; c < str.length; c++) {
    const code = str.charCodeAt(c);
    crc ^= code << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc = crc << 1;
      }
      crc &= 0xffff;
    }
  }
  return crc;
}
