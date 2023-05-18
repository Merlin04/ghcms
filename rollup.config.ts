import { string } from "rollup-plugin-string";
import typescript from "@rollup/plugin-typescript";
import run from "@rollup/plugin-run";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import dts from "rollup-plugin-dts";
import nativePlugin from "rollup-plugin-natives";
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
import { createRequire } from "module";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

`
    },
    plugins: [
        nativePlugin({
            copyTo: "dist/build", // hacky
            destDir: ".",
            dlopen: false,
            sourcemap: dev,
            targetEsm: true // doesn't do anything ????
        }),
        typescript(),
        string({
            include: "**/*.html"
        }),
        json(),
        nodeResolve(),
        commonjs({
            ignoreDynamicRequires: true // janky native module
        }),
        copy({
            targets: [
                { src: "package.json", dest: "dist" } // wow another stupid native module hack
            ]
        }),
        dev && run(),
        !dev && terser({
            compress: false // for some reason, with the janky native module thing having this on breaks it
        })
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