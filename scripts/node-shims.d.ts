// @types/node を入れていないため、scripts/check-docs.ts が使う分だけを宣言する。
// @types/node を入れたら、このファイルは消してよい。
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
}

declare module "node:path" {
  export const posix: {
    join(...parts: string[]): string;
    normalize(path: string): string;
    dirname(path: string): string;
  };
}
