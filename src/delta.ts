import { BlockMatchSpeed, XdeltaAlgorithm } from "xdelta-async-nodejs-addon";
import fsOld from "fs";
import fs from "fs/promises";
import config from "./config";
import readline from "readline";
import { saveObjectToString, stringToSaveObject } from "./saveFmt";

const xdelta = new XdeltaAlgorithm();
// we're using our own binary delta storage format
// here's a simplified version of it:
// there's a header consisting of the number of deltas in the file, then an array of delta chunks
// these are an unsigned 32-bit integer denoting size of the delta, followed by ascii D, followed by uint32_t unpacked size, followed by the delta itself
// followed by the next delta chunk, and so on
// the deltas are stored in reverse order, so the most recent delta is at the beginning of the file
// sometimes a delta is larger than the actual file, so in that case, just use the actual file (without a J prefix)

// here's a vaguely C struct representation
/*

struct data {
    uint32_t size;
    char str[size];
}

struct DeltasFile {
    uint32_t n_chunks;
    struct DeltaBlock {
        uint32_t ts;
        uint8_t type;
        data delta;
    } chunks[n_chunks];
}

*/

let _deltasFile: Buffer = null!;
const deltasFile = {
    get value() {
        if(_deltasFile !== null) return _deltasFile;
        try {
            _deltasFile = fsOld.readFileSync(config.deltasFile);
        } catch (e: any) {
            // check if file doesn't exist
            if (e.code !== "ENOENT") {
                throw e;
            }
            _deltasFile = Buffer.alloc(4);
            _deltasFile.writeUInt32BE(0);
        }
        return _deltasFile;
    },
    set value(value: Buffer) {
        _deltasFile = value;
    }
};

const saveDeltasFile = () => fs.writeFile(config.deltasFile, deltasFile.value);

export const appendDelta = async (old: string | Buffer, latest: string | Buffer) => {
    // convert old and latest to buffers if they aren't already
    if (typeof old === "string") {
        old = Buffer.from(old);
    }
    if (typeof latest === "string") {
        latest = Buffer.from(latest);
    }

    const delta = await xdelta.generateDeltaAsync(latest, old, old.length - 4 /* unpacked size uint32 */, BlockMatchSpeed.Default)
        .then((delta) => ({ isDelta: true, buf: delta }))
        .catch(() => ({ isDelta: false, buf: old as Buffer /* typescript moment */ }));
        
    const newDeltasFile = Buffer.alloc(
        4 + // timestamp
        4 + // delta size
        1 + // type flag
        (delta.isDelta ? 4 : 0) + // unpacked size
        delta.buf.length + // delta
        deltasFile.value.length // old deltas file
    );

    // copy into newDeltasFile
    let ptr = 0;
    newDeltasFile.writeUInt32BE(deltasFile.value.readUInt32BE(0) + 1, ptr);
    ptr += 4;
    newDeltasFile.writeUInt32BE(Math.floor(Date.now() / 1000), ptr);
    ptr += 4;
    newDeltasFile.writeUInt32BE(delta.buf.length, ptr);
    ptr += 4;
    newDeltasFile.writeUInt8(delta.isDelta ? 0x44 : 0x4a, ptr); // ascii D or J
    ptr += 1;
    if(delta.isDelta) {
        newDeltasFile.writeUInt32BE(old.length, ptr);
        ptr += 4;
    }
    delta.buf.copy(newDeltasFile, ptr);
    ptr += delta.buf.length;
    deltasFile.value.copy(newDeltasFile, ptr, 4);
    ptr += deltasFile.value.length - 4;

    // make sure allocation matches ptr
    if(ptr !== newDeltasFile.length) {
        throw new Error(`bytes written to buffer (${ptr}) does not match allocation (${newDeltasFile.length})`);
    }

    deltasFile.value = newDeltasFile;
    await saveDeltasFile();
};

type DeltasFile = {
    timestamp: Date,
    isDelta: boolean,
    unpackedSize?: number,
    data: Buffer
}[];

export const getDeltas = (): DeltasFile => {
    // writing needs to be fast, reading doesn't

    let ptr = 0;
    const n_chunks = deltasFile.value.readUInt32BE(ptr);
    ptr += 4;
    const deltas: DeltasFile = [];

    for(let i = 0; i < n_chunks; i++) {
        const timestamp = new Date(deltasFile.value.readUInt32BE(ptr) * 1000);
        ptr += 4;
        const dataSize = deltasFile.value.readUInt32BE(ptr);
        ptr += 4;
        const isDelta = deltasFile.value[ptr] === 0x44; // ascii D
        ptr += 1;
        let unpackedSize;
        if(isDelta) {
            unpackedSize = deltasFile.value.readUInt32BE(ptr);
            ptr += 4;
        }
        const data = Buffer.alloc(dataSize);
        deltasFile.value.copy(data, 0, ptr, ptr + dataSize);
        ptr += dataSize;
        deltas.push({ timestamp, isDelta, unpackedSize, data });
    }

    return deltas;
};

// for some reason this isn't in the xdelta-async-nodejs-addon library
const applyDeltaAsync = async (oldData: Buffer, delta: Buffer, maxResultSize: number) => {
    return new Promise<Buffer>((resolve, reject) => {
        xdelta.applyDelta(oldData, delta, maxResultSize, result => {
            if(result.error) {
                reject(result.error);
            } else {
                resolve(result.result);
            }
        });
    });
}

// get the n-th chunk's real data (0 is first chunk)
export const getNthChunk = async (f: DeltasFile, n: number): Promise<Buffer> => {
    // to get the data of a chunk for some n-th revision, we need its delta and the data of the n-1-th revision
    // however, if the n-1-th revision isn't a delta, we can just use it directly
    // we'll use this function recursively

    if(n === -1) {
        // read file from disk
        return await fs.readFile(config.saveFile);
    }

    return f[n].isDelta ? await applyDeltaAsync(await getNthChunk(f, n - 1), f[n].data, f[n].unpackedSize!) : f[n].data;
};

export const revertToChunk = async (f: DeltasFile, n: number) => {
    // assuming the deltasfile is representative of the current state of the buffer - improves perf but need to make sure before calling

    const nthChunk = await getNthChunk(f, n);
    await fs.writeFile(config.saveFile, nthChunk);

    // now, modify the deltasfile buffer to remove all chunks before the n-th one
    // first, get the pointer to the start of the (n+1)-th chunk
    let ptr = 4;
    for(let i = 0; i < n + 1; i++) {
        ptr += 4; // timestamp
        ptr += 4; // delta size
        ptr += 1; // type flag
        if(f[i].isDelta) {
            ptr += 4; // unpacked size
        }
        ptr += f[i].data.length;
    }

    // now, copy the rest of the buffer into a new one (with updated n_chunks)
    const n_chunks = f.length - n - 1;
    const newDeltasFile = Buffer.alloc(
        4 + // n_chunks
        deltasFile.value.length - ptr // rest of buffer
    );
    newDeltasFile.writeUInt32BE(n_chunks, 0);
    deltasFile.value.copy(newDeltasFile, 4, ptr);

    deltasFile.value = newDeltasFile;
    await saveDeltasFile();
};

const getPrompt = () => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = (query: string) => new Promise<string>((resolve) => rl.question(query, resolve));

    return { rl, prompt };
};

export const runCli = async () => {
    // simple CLI to allow viewing and reverting to chunks
    const { rl, prompt } = getPrompt();

    let f = getDeltas();

    console.log("commands:\nl - list revisions\nr [id] - view revision\nv [id] - revert to revision\nq - quit\n");

    while(true) {
        console.log(`current state: ${f.length - 1} revisions, last revision at ${f[f.length - 1].timestamp.toLocaleString()}`);
        const input = await prompt("> ");
        switch(input) {
            case "l":
                console.log(`ID\tTimestamp\n${f.map((chunk, i) => `${i}\t${chunk.timestamp.toLocaleString()}`).join("\n")}`);
                break;
            case "q":
                rl.close();
                return;
            default:
                if(input.startsWith("r ")) {
                    const id = Number(input.split(" ")[1]);
                    if(isNaN(id)) {
                        console.log("invalid id");
                    } else {
                        try {
                            console.log((await getNthChunk(f, id)).toString());
                        } catch(e) { console.error(e); }
                    }
                } else if(input.startsWith("v ")) {
                    // confirmation
                    if(await prompt("reverting is irreversible, and you will lose all revisions after the version you are reverting to. Type 'yes' to confirm: ") !== "yes") {
                        console.log("aborting");
                        break;
                    }

                    const id = Number(input.split(" ")[1]);
                    if(isNaN(id)) {
                        console.log("invalid id");
                    }

                    await revertToChunk(f, id);
                    f = getDeltas();
                    console.log("reverted");
                } else {
                    console.log("invalid command");
                }
        }
    }
};

export const checkIfEditing = async () => {
    if(!fsOld.existsSync(config.saveFile + ".orig")) return;
    throw new Error("Manual edit to save file is in progress. Please finish your edit with `ghcms edit commit` or exit without saving with `ghcms edit undo`.")
}

export const runEdit = async () => {
    const { rl, prompt } = getPrompt();
    // get sub-command - either "start" or "commit"
    const subcommand = process.argv[3];

    const subcommands = {
        start: async () => {
            await fs.copyFile(config.saveFile, config.saveFile + ".orig");
            await fs.writeFile(config.saveFile, JSON.stringify(stringToSaveObject(await fs.readFile(config.saveFile, "utf8")), null, 4));
        },
        commit: async () => {
            const newSaveString = saveObjectToString(JSON.parse(await fs.readFile(config.saveFile, "utf8")));
            await fs.writeFile(config.saveFile, newSaveString);
            const oldSaveString = await fs.readFile(config.saveFile + ".orig", "utf8");
            await appendDelta(oldSaveString, newSaveString);
            await fs.unlink(config.saveFile + ".orig");
        },
        undo: async () => {
            // confirm
            if(await prompt("undoing your manual edits to the save file cannot be undone, and you will lose all changes since you ran `ghcms edit start`. Type 'yes' to confirm: ") !== "yes") {
                console.log("aborting");
                return;
            }
            await fs.copyFile(config.saveFile + ".orig", config.saveFile);
            await fs.unlink(config.saveFile + ".orig");
        }
    };

    if(!(subcommand in subcommands)) {
        console.log("invalid subcommand - must be either `start`, `commit`, or `undo`");
        return;
    }

    await subcommands[subcommand as keyof typeof subcommands]();
    rl.close();
};