/** パスの `:id` を、正の整数に直す。整数でなければ null */
export function parseId(param: string): number | null {
  return /^[1-9]\d{0,14}$/.test(param) ? Number(param) : null;
}
