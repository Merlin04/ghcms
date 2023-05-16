import fs from "fs";
import config from "./config";

let _save: SaveFile = null!;
const save = {
  get value() {
    if (_save === null) {
      try {
        _save = JSON.parse(fs.readFileSync(config.saveFile, "utf-8"));
      } catch (e: any) {
        // check if file doesn't exist
        if (e.code !== "ENOENT") {
          throw e;
        }
        _save = [];
      }
    }
    return _save;
  },
  set value(value: SaveFile) {
    _save = value;
    fs.writeFileSync(config.saveFile, JSON.stringify(value));
  }
}
export default save;

export type SaveFile = {
  // GH fields
  repo: string, // repo full name
  name: string, // user-editable name (defaults to repo name)
  summary: string // original repository summary
  description: string, // user-editable description
  // system fields
  order: number, // order in the list
  // custom fields ?
//   include: boolean, // field used by generator
  [key: `c_${string}`]: any // custom fields
}[];