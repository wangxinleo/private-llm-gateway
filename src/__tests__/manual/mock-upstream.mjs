import http from "node:http";

const PORT = 8787;

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Received-Method", req.method);
    res.setHeader("X-Received-Path", req.url ?? "/");
    res.end(
      JSON.stringify({
        method: req.method,
        path: req.url,
        headers: req.headers,
        body,
      })
    );
  });
});

server.listen(PORT, () => {
  console.log(`Mock upstream listening on :${PORT}`);
});
