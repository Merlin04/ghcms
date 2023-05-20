import { string } from "rollup-plugin-string";
import typescript from "@rollup/plugin-typescript";
import run from "@rollup/plugin-run";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";
import copy from "rollup-plugin-copy";

const dev = process.env.ROLLUP_WATCH === "true";

/**
 * @type {import('rollup').RollupOptions}
 */
export default [{
    input: "src/index.ts",
    output: {
        dir: "dist",
        format: "es",
        // output to index.mjs
        entryFileNames: "[name].mjs",
        banner: `#!/usr/bin/env node
import { fileURLToPath } from "url";
import { dirname } from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

`
    },
    plugins: [
        typescript(),
        string({
            include: "**/*.html"
        }),
        json(),
        nodeResolve(),
        commonjs(),
        copy({
            targets: [
                { src: "./node_modules/xdelta3-wasm/dist/*.wasm", dest: "dist" }
            ]
        }),
        dev && run(),
        !dev && terser()
    ]
}, ...(!dev ? [{
    input: "src/index.ts",
    output: {
        file: "dist/index.d.ts",
        format: "es"
    },
    plugins: [
        dts()
    ]
}] : [])];