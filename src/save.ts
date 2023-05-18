import oldFs from "fs";
import fs from "fs/promises";
import config from "./config";
import { appendDelta } from "./delta";
import { SaveFile, stringToSaveObject, saveObjectToString } from "./saveFmt";

let _save: SaveFile = null!;
const save = {
    get value() {
        if (_save === null) {
            try {
                _save = stringToSaveObject(oldFs.readFileSync(config.saveFile, "utf-8"));
            } catch (e: any) {
                // check if file doesn't exist
                if (e.code !== "ENOENT") {
                    throw e;
                }
                _save = [];
                fs.writeFile(config.saveFile, saveObjectToString(_save));
            }
        }
        return _save;
    },
    set value(value: SaveFile) {
        const oldSave = saveObjectToString(save.value);
        const newSave = saveObjectToString(value);
        _save = value;
        oldFs.writeFileSync(config.saveFile + ".0", oldSave);
        oldFs.writeFileSync(config.saveFile, newSave);
        
        appendDelta(oldSave, newSave).then(async () => {
            await fs.unlink(config.saveFile + ".0");
        }).catch(console.error);
    }
};
export default save;