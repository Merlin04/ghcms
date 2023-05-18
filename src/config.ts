import path from "path";
import fs from "fs/promises";
import fsOld from "fs";
import { SaveFilePublic } from "./saveFmt";

const configPath = process.env.GHCMS_CONFIG ?? "./ghcms.config.mjs";

const INITIAL_CONFIG = `/**
 * @type {import("@merlin04/ghcms").ConfigObj}
 */
export const config = {
    users: ["Merlin04"],
    saveFile: "./ghcms.json",
    deltasFile: "./ghcms.deltas",
    output: "./ghcms.md",
    customFields: [{
        key: "include",
        displayName: "?",
        type: "checkbox",
        default: false
    }]
};

/**
 * @type {import("@merlin04/ghcms").ConfigFn}
 */
export default async (save) => {
    return save.map(s => \`- \${s.name}: \${s.description}\`).join("\\n");
};`;

if(!fsOld.existsSync(configPath)) {
    await fs.writeFile(configPath, INITIAL_CONFIG);
    console.log(`✨ created new config file at ${configPath}, edit and save to load changes!`);
}

type CustomField = {
    key: string,
    displayName: string,
    type: "text" | "textarea" | "checkbox",
    default?: string | boolean
};
type CustomFieldInternal = Omit<CustomField, "default" | "key"> & {
    default: string | boolean,
    key: `c_${string}`
};
export type ConfigFn = (save: SaveFilePublic) => string | Promise<string>;
export type ConfigObj = {
    users: string[],
    saveFile: string,
    deltasFile: string,
    output: string,
    customFields: CustomField[]
};

type ConfigModule = {
    default: ConfigFn,
    config: ConfigObj
};

const validateModule = (m: ConfigModule) => {
    if(!m.default || typeof m.default !== "function" || m.default.length !== 1) {
        throw new Error("The file must export a default function that takes a single argument");
    }
    if(!m.config || typeof m.config !== "object") {
        throw new Error("The file must export a `config` object");
    } else {
        if(!m.config.users || !Array.isArray(m.config.users)) {
            throw new Error("The exported config object must contain a `users` array");
        }
        if(!m.config.saveFile || typeof m.config.saveFile !== "string") {
            throw new Error("The exported config object must contain a `saveFile` file path string");
        }
        if(!m.config.deltasFile || typeof m.config.deltasFile !== "string") {
            throw new Error("The exported config object must contain a `deltasFile` file path string");
        }
        if(!m.config.output || typeof m.config.output !== "string") {
            throw new Error("The exported config object must contain an `output` file path string");
        }
    }
};

let m: ConfigModule = await import(path.resolve(configPath));
validateModule(m);

fsOld.watch(path.resolve(configPath), async () => {
    console.log("Config file changed, reloading...");
    try {
        const newMod = await import(path.resolve(configPath) + "?t=" + Date.now());
        validateModule(newMod);
        m = newMod;
        console.log("Config file reloaded");
    } catch(e) {
        console.error("Error reloading config file:", e);
    }
});

export default {
    get default() {
        return m.default;
    },
    get users() {
        return m.config.users;
    },
    get saveFile() {
        return m.config.saveFile;
    },
    get deltasFile() {
        return m.config.deltasFile;
    },
    get output() {
        return m.config.output;
    },
    get customFields(): CustomFieldInternal[] {
        return m.config.customFields.map(f => ({
            ...f,
            default: f.default ?? (f.type === "checkbox" ? false : ""),
            key: `c_${f.key}`
        }));
    }
};