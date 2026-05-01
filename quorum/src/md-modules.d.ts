// Ambient declaration so TypeScript accepts `import x from "*.md"` imports.
// Wrangler's Text rule (wrangler.jsonc) injects the file content as a string at build time.
declare module "*.md" {
  const text: string;
  export default text;
}
