import { string } from "rollup-plugin-string";
import typescript from "@rollup/plugin-typescript";
import run from "@rollup/plugin-run";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import terser from "@rollup/plugin-terser";
import shebang from "rollup-plugin-add-shebang";
import dts from "rollup-plugin-dts";

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
        entryFileNames: "[name].mjs"
    },
    plugins: [
        typescript(),
        string({
            include: "**/*.html"
        }),
        json(),
        nodeResolve(),
        commonjs(),
        shebang({
            include: "**/*.mjs"
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