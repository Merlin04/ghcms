import oldFs from "fs";
import fs from "fs/promises";
import config from "./config";
import { appendDelta } from "./delta";

let _save: SaveFile = null!;
const save = {
    get value() {
        if (_save === null) {
            try {
                _save = JSON.parse(oldFs.readFileSync(config.saveFile, "utf-8"));
            } catch (e: any) {
                // check if file doesn't exist
                if (e.code !== "ENOENT") {
                    throw e;
                }
                _save = [];
                fs.writeFile(config.saveFile, JSON.stringify(_save));
            }
        }
        return _save;
    },
    set value(value: SaveFile) {
        const oldSave = JSON.stringify(save.value);
        const newSave = JSON.stringify(value);
        _save = value;
        oldFs.writeFileSync(config.saveFile + ".0", oldSave);
        oldFs.writeFileSync(config.saveFile, newSave);
        
        appendDelta(oldSave, newSave).then(async () => {
            await fs.unlink(config.saveFile + ".0");
        }).catch(console.error);
    }
};
export default save;

export type SaveFile = {
    // GH fields
    repo: string; // repo full name
    name: string; // user-editable name (defaults to repo name)
    summary: string; // original repository summary
    description: string; // user-editable description
    // system fields
    order: number; // order in the list
    // custom fields
    [key: `c_${string}`]: string | boolean;
}[];

// copied for better intellisense in config file
export type SaveFilePublic = ({
    // GH fields
    repo: string; // repo full name
    name: string; // user-editable name (defaults to repo name)
    summary: string; // original repository summary
    description: string; // user-editable description
    // system fields
    order: number; // order in the list
} & Record<string, string | boolean>)[];
