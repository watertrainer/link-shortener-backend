const http = require('http');
const handler = require("./requestHandler");
const { Pool } = require('pg')
const pool = new Pool()
const port = 3000;


const server = http.createServer(async (req, res) => {

    await handler.handleRequest(req, res, pool);
});

server.listen(port,async () => {
    console.log(`Server running at ${port}`);
});