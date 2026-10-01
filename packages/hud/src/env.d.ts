// Ambient module declarations for non-TS imports handled by Vite (and the Vitest transform).
declare module '*.css';
declare module '*.css?inline' {
  const css: string;
  export default css;
}
declare module '*.svg?raw' {
  const svg: string;
  export default svg;
}
