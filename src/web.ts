// let's try just using the http module directly and see where it takes us
import http from "http";

export type Route = {
    path: string;
    handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>;
};

export enum ContentType {
    HTML = "text/html",
    JSON = "application/json",
    TEXT = "text/plain",
};
  
export const content = (res: http.ServerResponse, type: ContentType, body: string) => {
    res.writeHead(200, { "Content-Type": type });
    res.write(body);
    res.end();
};
  
export const body = (req: http.IncomingMessage) => new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
        body += chunk;
    });
    req.on("end", () => {
        resolve(body);
    });
});
  

export default async function serve(routes: Route[]) {
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
    
    const runServer = (port: number) => server.listen(port);

    // find available port, starting at 3000
    let port = 3000;
    for(;; port++) {
        try {
            await new Promise((resolve, reject) => {
                runServer(port);
                server.once("error", reject);
                server.once("listening", resolve);
            });
            break;
        } catch(e: any) {
            if(e.code !== "EADDRINUSE") {
                throw e;
            } else {
                console.log(`Port ${port} is in use, trying next port...`);
            }
        }
    }
    console.log(`Server listening on port ${port}`);
    console.log(`💡 reminder! ghcms stores revision history - run \`ghcms history\` for more`);
}