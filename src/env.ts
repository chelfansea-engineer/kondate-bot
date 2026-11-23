export type Env = {
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  /** LIFFを載せたLINEログインチャネルのID。IDトークンの検証で audience として使う */
  LIFF_CHANNEL_ID: string;
  DB: D1Database;
};

/** /api/* のミドルウェアが検証してから入れる、リクエスト単位の値 */
export type Variables = {
  userId: string;
};

export type AppEnv = { Bindings: Env; Variables: Variables };
