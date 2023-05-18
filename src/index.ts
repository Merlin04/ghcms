import index from "./index.html";
import { Octokit } from "@octokit/rest";
import { writeFile } from "fs/promises";
import config from "./config";
import save, { SaveFilePublic, type SaveFile } from "./save";
import serve, { ContentType, content, body } from "./web";

export type { ConfigObj, ConfigFn } from "./config";

const octokit = new Octokit({});

async function getRepos() {
    return (
        await Promise.all(
            config.users.map(async (user) => {
                const data = await octokit.paginate(octokit.repos.listForUser, {
                    username: user,
                    type: "owner",
                    sort: "updated"
                });
                return data;
            })
        )
    )
        .flat()
        .sort((a, b) => {
            // manually sort by pushed_at
            const aDate = new Date(a.pushed_at!);
            const bDate = new Date(b.pushed_at!);
            return bDate.getTime() - aDate.getTime();
        })
        .filter(
            (r, i, a) => a.findIndex((r2) => r2.full_name === r.full_name) === i
        );
}

const updateSave = (
    save: SaveFile,
    repos: Awaited<ReturnType<typeof getRepos>>
): SaveFile => {
    // add all the repos in `repos` that aren't in `save` to the top, and shift the `order` accordingly
    const newRepos = repos
        .filter((r) => save.findIndex((s) => s.repo === r.full_name) === -1)
        .map<SaveFile[0]>((r, i) => ({
            repo: r.full_name,
            name: r.name,
            order: i,
            description: r.description ?? "",
            summary: r.description ?? "",
            ...Object.fromEntries(config.customFields.map((f) => [f.key, f.default]))
        }));
    return [
        ...newRepos,
        ...save.map((s, i) => ({
            ...s,
            order: i + newRepos.length,
            summary:
                repos.find((r) => r.full_name === s.repo)?.description ?? "",
            ...Object.fromEntries(config.customFields.map((f) => ([
                f.key, s[f.key] === undefined ? f.default : s[f.key]
            ])))
        }))
    ];
};

serve([
    {
        path: "/api/refreshgh",
        handler: async (req, res) => {
            const repos = await getRepos();
            const newSave = updateSave(save.value, repos);
            save.value = newSave;
            // redirect to /
            res.writeHead(302, { Location: "/" });
            res.end();
        }
    },
    {
        path: "/",
        handler: (req, res) => {
            content(
                res,
                ContentType.HTML,
                index
                    .replace("{DATA}", JSON.stringify(save.value))
                    .replace("{CUSTOM_FIELDS}", JSON.stringify(config.customFields))
            );
        }
    },
    {
        path: "/api/save",
        handler: (req, res) => {
            content(res, ContentType.JSON, JSON.stringify(save.value));
        }
    },
    {
        path: "/api/update",
        handler: async (req, res) => {
            // replace save with value in request body
            const b = await body(req);
            const newSave = JSON.parse(b);
            save.value = newSave;
            // success
            content(res, ContentType.TEXT, "OK");
        }
    },
    {
        path: "/api/generate",
        handler: async (req, res) => {
            // generate the file
            const v = await config.default(
                Array.from({ length: save.value.length }, (_, i) => {
                    let r: SaveFile[number] | undefined = save.value.find((v) => v.order === i);
                    if (!r)
                        throw new Error(
                            "Invalid order in save file! This should never happen."
                        );
                    // replace custom field keys c_key with key
                    r = { ...r };
                    for (const f of config.customFields) {
                        //@ts-expect-error
                        r[f.key.slice(2)] = r[f.key];
                        delete r[f.key];
                    }
                    return r as SaveFilePublic[number];
                })
            );
            await writeFile(config.output, v);
            // success
            console.log("Generated output file!");
            content(res, ContentType.TEXT, "OK");
        }
    }
]);
