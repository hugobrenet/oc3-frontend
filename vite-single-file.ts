import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { constants, gzipSync } from "node:zlib";
import type { Plugin, Rollup, UserConfig } from "vite";

/**
 * The build as one self-contained `index.html`, for `vite build --mode single`:
 * the script, the stylesheet and every asset (fonts, images, the favicon) inlined,
 * nothing else written but its gzip, `index.html.gz`, served as is by an nginx with
 * gzip_static.
 *
 * Written here rather than imported: inlining a single script and a single
 * stylesheet into the page takes these lines.
 *
 * The page carries its own Content-Security-Policy in a <meta>, as strict as the
 * one of `deploy/nginx/security-headers.conf` but for what inlining needs: its
 * one script by hash, fonts and images as data URIs. Served behind that nginx
 * configuration, whose header forbids inline scripts, it would not run: a server
 * of the single file sends no CSP header of its own, or that one.
 */
export function singleFile(publicDir: string): { config: UserConfig; plugin: Plugin } {
  const config: UserConfig = {
    build: {
      outDir: "dist-single",
      // Every asset as a data URI, whatever its size: there is no file to load.
      assetsInlineLimit: () => true,
      cssCodeSplit: false,
      modulePreload: false,
      copyPublicDir: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
    },
  };

  const plugin: Plugin = {
    name: "oc3-single-file",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find(
        (item): item is Rollup.OutputAsset =>
          item.type === "asset" && item.fileName === "index.html",
      );
      if (html === undefined) this.error("no index.html in the bundle");
      let page = String(html.source);
      const hashes: string[] = [];

      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === "chunk" && item.isEntry) {
          // A "</script" in the code would end the element early.
          const code = item.code.replace(/<\/(script)/gi, "<\\/$1");
          hashes.push(createHash("sha256").update(code).digest("base64"));
          page = page.replace(
            new RegExp(`<script[^>]*src="[^"]*${escape(item.fileName)}"[^>]*></script>`),
            () => `<script type="module">${code}</script>`,
          );
          delete bundle[name];
        } else if (item.type === "asset" && item.fileName.endsWith(".css")) {
          const css = String(item.source);
          page = page.replace(
            new RegExp(`<link[^>]*href="[^"]*${escape(item.fileName)}"[^>]*>`),
            () => `<style>${css}</style>`,
          );
          delete bundle[name];
        }
      }

      // The favicon, from public/, which this build does not copy.
      const icon = readFileSync(`${publicDir}/favicon.ico`).toString("base64");
      page = page.replace(/href="\/favicon\.ico"/, `href="data:image/x-icon;base64,${icon}"`);

      const csp = [
        "default-src 'self'",
        `script-src ${hashes.map((h) => `'sha256-${h}'`).join(" ")}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; ");
      page = page.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      );

      const leftover = Object.keys(bundle).filter((name) => name !== "index.html");
      if (leftover.length > 0) this.error(`not inlined: ${leftover.join(", ")}`);
      html.source = page;
      this.emitFile({
        type: "asset",
        fileName: "index.html.gz",
        source: gzipSync(page, { level: constants.Z_BEST_COMPRESSION }),
      });
    },
  };
  return { config, plugin };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
