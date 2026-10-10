// stylis ships no TypeScript declarations of its own (and @types/stylis isn't a dependency);
// rtlCache.ts only needs its `prefixer` plugin, typed as the plugin shape @emotion/cache expects.
declare module "stylis" {
  import type { StylisPlugin } from "@emotion/cache";

  export const prefixer: StylisPlugin;
}
