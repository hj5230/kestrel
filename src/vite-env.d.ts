/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KESTREL_BACKEND?: string
  readonly VITE_KESTREL_TOKEN?: string
}

/** package.json version at build time (vite.config.ts). */
declare const __APP_VERSION__: string
