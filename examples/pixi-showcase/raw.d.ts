// Vite `?raw` imports (the showcase loads the donor's TSV tables as text).
declare module '*?raw' {
  const content: string;
  export default content;
}
