const http = require('http');
const fs = require('fs');
const path = require('path'); const { Pool } = require('pg');
const { getHeapStatistics } = require('v8');
//map file extension to MIME types
const MIME_TYPES = {
    '.ico': 'image/x-icon',
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword'
};
//Validates that a given string is a valid URL
function validateUrl(url) {
    try {
        var queryUrl = new URL(url);
        //only allow https/http protocols, because protocols like javascript: and others can cause a security risk
        return queryUrl.protocol == "https:" || queryUrl.protocol == "http:"
    } catch (e) {
        return false;
    }
}
//creates a random string of a given length (see https://stackoverflow.com/a/1349426/18718228)
function randomString(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() *
            charactersLength));
    }
    return result;
}

async function redirect(req, res, pool, url) {
    //redirection logic
    const queryUrl = url.pathname.substring(1);
    //We need to use one client for all requests during an transaction
    client = await pool.connect()
    try {
        await client.query("BEGIN");
        db_res = await client.query("SELECT url FROM shortls WHERE shortl=$1", [queryUrl]);
        if (db_res.rows.length > 0) {
            res.statusCode = 302;
            res.setHeader("Location", db_res.rows[0].url)

            await client.query("UPDATE shortls SET viewed=shortls.viewed+1 WHERE shortl=$1", [queryUrl])
            res.end();
            await client.query("COMMIT")
        } else {
            await client.query("ROLLBACK")
        }
    } catch (err) {
        await client.query("ROLLBACK");
        console.log(err)
    } finally {
        client.release()
    }
}
async function shortenUrl(req, res, pool) {
    if (req.method !== "POST") {
        res.statusCode = 405;
        res.setHeader('Content-Type', "text/plain");
        res.end("Only POST requests allowed")
        return;
    }
    var body = "";
    req.on('data', (chunk) => {
        body += chunk;
    });
    req.on('end', async () => {
        const queryUrl = (JSON.parse(body).url);
        //try the url
        //The URL has to be tested in the Backend to stop request forging from being a security risk
        if (!validateUrl(queryUrl)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', "text/plain");
            res.end("The URL is invalid")
            return;
        }
        var shortl = randomString(6);
        try {
            db_res = await pool.query(
                "INSERT INTO shortls(url,shortl,viewed,shortened) VALUES ($1,$2,0,0) \
            ON CONFLICT (url) DO UPDATE SET shortened = shortls.shortened+1 \
            RETURNING (shortl);", [queryUrl, shortl])
            res.statusCode = 200;
            res.setHeader("Content-type", "application/json")
            res.end(JSON.stringify(db_res.rows[0]));
            return;
        } catch (err) {
            res.statusCode = 500;
            //If the error message is about the shortl key, send a accurate Error message
            if (err.detail.includes("already exists.") && err.detail.includes("Key (shortl)=")) {
                console.log(err.detail)
                //There is a chance that this error occures. When the random functions returns an existing Key.
                //Send an internal Server Error, so that the client retries the request, when it should be fixed
                res.setHeader('Content-Type', "text/plain");
                res.end("The random method generated an already exiting key. Try again.");
                return;
            } else {
                console.log(err)
                res.setHeader('Content-Type', "text/plain");
                res.end("An unknown Server Error occured, please try again");
                return;
            }

        }
    });
}

async function getStats(req, res, pool, url) {
    const queryUrl = url.searchParams.get("url");
    const queryShortl = url.searchParams.get("shortl");
    try {
        let db_res;
        if (queryUrl !== null && queryUrl !== "") {
            //if both are set we prefer queryUrl, although this shouldn't happen and thus the behavior is undefined
            db_res = await pool.query("SELECT * FROM shortls WHERE url=$1;", [queryUrl])
        } else if (queryShortl !== "" && queryShortl !== null) {
            db_res = await pool.query("SELECT * FROM shortls WHERE shortl=$1;", [queryShortl])
        } else {
            res.statusCode = 400;
            res.setHeader("Content-Type", "text/plain");
            res.end("Wrong parameters sent");
            return;
        }
        //sample data for api calls for stats
        if (db_res.rows.length > 0) {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(db_res.rows[0]));
            return;
        } else {

            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end("The url has not been shortened yet!");
            return;
        }
    }
    catch (err) {
        console.log(err)
        res.statusCode = 400;
        res.setHeader('Content-Type', 'text/plain');
        res.end("An unknown error occured");
        return;
    }
}

function serveIndexHtml(req, res) {
    fs.readFile("./dist/index.html", function (err, data) {
        if (err) {
            //This should NEVER happen.
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end("This should NEVER happen. Please contact the server admin, the frontend files have not been found.");
        } else {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html');
            res.end(data);
        }
    })
}

function serveFile(req, res, pathname) {
    fs.readFile(pathname, function (err, data) {
        if (err) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            res.end("The requested File was no found.");
        } else {
            const ext = path.parse(pathname).ext;
            res.statusCode = 200;
            var content_type = MIME_TYPES[ext];
            //If the conent type is not known, use text/plain, a undefined content type could crash the server
            if (content_type === undefined) {
                content_type = 'text/plain';
            }
            res.setHeader('Content-Type', content_type);
            res.end(data);
        }
    })
}
async function handleRequest(req, res, pool) {
    //get the full url for further parsing
    var url = new URL(req.url, req.protocol + '://' + req.headers.host);
    if (url.pathname === "/") {
        //If trying to open the root of the webpage, redirect to the frontend
        res.statusCode = 302;
        res.setHeader('Location', "/home");
        res.end();
    } else if (url.pathname.startsWith("/home")) {
        //default routing behaviour for an Angular app, see https://angular.io/guide/deployment#server-configuration
        //checks if the requested file exits, if not serve index.html
        //construct path to requested File
        const pathname = url.pathname.replace("/home", "./dist");
        //The extra cases are still the homepage, so we don't want to try to load a different file
        if (!((url.pathname === "/home") || (url.pathname === "/home/")) && fs.existsSync(pathname)) {
            serveFile(req, res, pathname)
        } else {
            serveIndexHtml(req, res)
        }
    } else if (url.pathname.startsWith("/api")) {//api calls for new shortened links or stats
        if (url.pathname.startsWith("/api/stats")) {
            await getStats(req, res, pool, url);

        } else if (url.pathname.startsWith("/api/shorten")) {
            await shortenUrl(req, res, pool)
        }
    } else {
        await redirect(req, res, pool, url);
    }
}
module.exports = {
    handleRequest: handleRequest,
    validateUrl: validateUrl
}