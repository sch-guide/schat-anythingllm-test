import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

export async function helpFixture(platform = "browser") {
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {renderToStaticMarkup} from 'react-dom/server';
        import {Help, Card, Field} from './src/pages/SchatAdmin/ui.jsx';
        import './src/pages/SchatAdmin/uiHelp.css';
        function Example(){return <main style={{width:'100%'}}>
          <Card title="첫 도움말" description="짧은 소개" help={['첫 설명을 확인해요.', '긴설명'.repeat(100)+'도 줄을 바꿔서 읽어요.']}><p>카드 본문</p></Card>
          <Help label="두 번째 도움말" heading={<h2>둘째 제목</h2>}>{['둘째 설명이에요.', '각각 열고 닫아요.']}</Help>
          <Field label="항목" help="항상 보이는 입력 안내"><input/></Field>
        </main>}
        ${platform === "browser" ? "createRoot(document.getElementById('root')).render(<Example/>);" : "export const html=renderToStaticMarkup(<Example/>);"}`,
      resolveDir: root,
      loader: "jsx",
    },
    bundle: true,
    write: false,
    outdir: "inline-help-test-output",
    platform,
    format: platform === "browser" ? "iife" : "cjs",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  return {
    js: result.outputFiles.find((file) => file.path.endsWith(".js")).text,
    css:
      result.outputFiles.find((file) => file.path.endsWith(".css"))?.text || "",
  };
}
