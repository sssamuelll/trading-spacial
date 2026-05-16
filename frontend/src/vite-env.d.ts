/// <reference types="vite/client" />

// CSS modules — let TS resolve them as a stylesheet record.
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
