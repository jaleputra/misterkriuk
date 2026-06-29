/**
 * QRIS static-to-dynamic converter (EMVCo specification).
 * Parses static QRIS payload, inserts/replaces Tag 54 (amount),
 * and recalculates the CRC16 checksum at Tag 63.
 */

export function generateDynamicQris(staticQris: string, amount: number): string {
  if (!staticQris) return "";

  // 1. Remove the old CRC16 (last 4 characters after "6304")
  let qris = staticQris.trim();
  if (qris.length < 4) return staticQris;
  qris = qris.slice(0, -4);

  // 2. Parse TLV (Tag-Length-Value) blocks and skip tag 54 (amount) if it exists,
  // then rebuild everything up to tag 63.
  let idx = 0;
  let newQris = "";
  while (idx < qris.length) {
    const tag = qris.slice(idx, idx + 2);
    const lenVal = qris.slice(idx + 2, idx + 4);
    const len = parseInt(lenVal, 10);
    const val = qris.slice(idx + 4, idx + 4 + len);

    if (isNaN(len)) {
      // Safety break for malformed payloads
      break;
    }

    if (tag === "54") {
      // Skip the old amount tag
    } else if (tag === "63") {
      // Reached the CRC tag
      break;
    } else {
      newQris += tag + lenVal + val;
    }
    idx += 4 + len;
  }

  // 3. Add the new amount tag 54
  const amtStr = Math.round(amount).toString();
  const amtLen = amtStr.length.toString().padStart(2, "0");
  newQris += "54" + amtLen + amtStr;

  // 4. Add the CRC tag 6304
  newQris += "6304";

  // 5. Calculate CRC16 CCITT (false) of newQris
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
