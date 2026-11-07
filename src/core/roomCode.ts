/** 房间码：6 位，字符集去掉易混淆的 0/O/1/I */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;

export function generateRoomCode(): string {
  const random = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(random);
  let code = '';
  for (const byte of random) code += ALPHABET[byte % ALPHABET.length];
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of code) if (!ALPHABET.includes(ch)) return false;
  return true;
}
