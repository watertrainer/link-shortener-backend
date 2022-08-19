const http = require('http');
const handler = require("./requestHandler");
const hostname = '127.0.0.1';
const port = 3000;


const server = http.createServer(async (req, res) => {

    await handler.handleRequest(req, res);
});

server.listen(port, hostname, async () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});