// let's try just using the http module directly and see where it takes us
import http from "http";
import dotenv from "dotenv";
import index from "./index.html";
import { Octokit } from "@octokit/rest";
import fs from "fs";
import { writeFile } from "fs/promises";
import path from "path";

dotenv.config();

const config = {
  users: process.env.GITHUB_USER?.split(",") ?? [/*"Merlin04",*/ "obl-ong"],
  saveFile: process.env.SAVE_FILE ?? "./ghcms.json",
  output: process.env.OUTPUT ?? "./ghcms.mdx"
};

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

type SaveFile = {
  repo: string,
  order: number,
  include: boolean,
  description: string,
  orig: string
}[]

const octokit = new Octokit({});

async function getRepos() {
  return (await Promise.all(config.users.map(async (user) => {
    const data = await octokit.paginate(octokit.repos.listForUser, {
      username: user,
      type: "owner",
      sort: "updated"
    });
    return data;
  }))).flat().sort((a, b) => {
    // manually sort by pushed_at
    const aDate = new Date(a.pushed_at!);
    const bDate = new Date(b.pushed_at!);
    return bDate.getTime() - aDate.getTime();
  }).filter((r, i, a) => a.findIndex(r2 => r2.full_name === r.full_name) === i);
}

const updateSave = (save: SaveFile, repos: Awaited<ReturnType<typeof getRepos>>) => {
  // add all the repos in `repos` that aren't in `save` to the top, and shift the `order` accordingly
  const newRepos = repos.filter(r => save.findIndex(s => s.repo === r.full_name) === -1).map((r, i) => ({
    repo: r.full_name,
    order: i,
    include: false,
    description: r.description ?? "",
    orig: r.description ?? ""
  }));
  return [
    ...newRepos,
    ...save.map((s, i) => ({
      ...s,
      order: i + newRepos.length,
      orig: repos.find(r => r.full_name === s.repo)?.description ?? ""
    }))
  ];
};

const generate = async () => {
  // get absolute path of ./ghcms.js
  const ghcmsPath = path.resolve("./ghcms.mjs");
  const mod = await import(ghcmsPath + "?t=" + Date.now());
  const v = mod.default(Array.from({ length: save.value.length }, (_, i) => save.value.find(v => v.order === i)));
  await writeFile(config.output, v);
}

type Route = {
  path: string;
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
};

// passthrough template tags for syntax highlighting
const html = String.raw;

enum ContentType {
  HTML = "text/html",
  JSON = "application/json",
  TEXT = "text/plain",
};

const content = (res: http.ServerResponse, type: ContentType, body: string) => {
  res.writeHead(200, { "Content-Type": type });
  res.write(body);
  res.end();
};

const body = (req: http.IncomingMessage) => new Promise<string>((resolve, reject) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    resolve(body);
  });
});

const routes: Route[] = [{
  path: "/api/refreshgh",
  handler: async (req, res) => {
    const repos = await getRepos();
    const newSave = updateSave(save.value, repos);
    save.value = newSave;
    // redirect to /
    res.writeHead(302, { "Location": "/" });
    res.end();
  }
}, {
  path: "/",
  handler: (req, res) => {
    content(res, ContentType.HTML, index.replace("{DATA}", JSON.stringify(save.value)));
  }
}, {
  path: "/api/save",
  handler: (req, res) => {
    content(res, ContentType.JSON, JSON.stringify(save.value));
  }
}, {
  path: "/api/update",
  handler: async (req, res) => {
    // replace save with value in request body
    const b = await body(req);
    const newSave = JSON.parse(b);
    save.value = newSave;
    // success
    content(res, ContentType.TEXT, "OK");
  },
}, {
  path: "/api/generate",
  handler: async (req, res) => {
    // generate the file
    await generate();
    // success
    content(res, ContentType.TEXT, "OK");
  }
}];

const server = http.createServer((req, res) => {
  const route = routes.find((route) => route.path === req.url);
  if (route) {
    route.handler(req, res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.write("Not Found");
    res.end();
  }
});

server.listen(3000, () => {
  console.log("Server listening on port 3000");
});