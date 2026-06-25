import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number.parseInt(process.env.PORT || "4173", 10);
const host = process.env.HOST || "0.0.0.0";

const contentTypesByExtension = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wav", "audio/wav"],
]);

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const normalizedPath = normalize(decodedPath === "/" ? "/index.html" : decodedPath);
  const requestedFilePath = resolve(join(repositoryRoot, normalizedPath));

  if (
    requestedFilePath !== repositoryRoot
    && !requestedFilePath.startsWith(`${repositoryRoot}${sep}`)
  ) {
    return null;
  }

  return requestedFilePath;
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  const requestedFilePath = resolveRequestPath(request.url);
  if (!requestedFilePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const fileStats = await stat(requestedFilePath);
    if (!fileStats.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    const contentType = contentTypesByExtension.get(extname(requestedFilePath))
      || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    createReadStream(requestedFilePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Stop Motion Station is running at http://localhost:${port}`);
});
