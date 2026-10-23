declare module "*.wasm" {
  const path: string;
  export default path;
}
declare module "*.lean" {
  const source: string;
  export default source;
}
