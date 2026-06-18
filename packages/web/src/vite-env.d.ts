// Vite serves the Walrus encoder wasm as a URL asset; type that import.
declare module "*.wasm?url" {
  const url: string;
  export default url;
}
