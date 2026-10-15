/**
 * @file declarations.d.ts
 * frontend/src/declarations.d.ts
 * @description CSSやSCSSなどの非TypeScriptファイルをモジュールとして読み込めるようにするための型定義ファイル
 */
declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.module.scss' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.module.sass' {
  const classes: { [key: string]: string };
  export default classes;
}
declare module '*.css' {
  const content: { [className: string]: string };
  export default content;
}

declare module '*.scss' {
  const content: { [className: string]: string };
  export default content;
}