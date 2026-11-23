import type { D1Migration } from "@cloudflare/vitest-plugin";
import type { Env } from "../src/env";

declare global {
  namespace Cloudflare {
    // cloudflare:test の env に、本番と同じバインディングとテスト用の値を持たせる
    interface Env extends AppEnvBindings {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

type AppEnvBindings = Env;
