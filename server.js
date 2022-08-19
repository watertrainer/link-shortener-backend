const http = require('http');
const handler = require("./requestHandler");
const { Pool } = require('pg')
const pool = new Pool()
const hostname = '127.0.0.1';
const port = 3000;


const server = http.createServer(async (req, res) => {

    await handler.handleRequest(req, res, pool);
});

server.listen(port, hostname, async () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});