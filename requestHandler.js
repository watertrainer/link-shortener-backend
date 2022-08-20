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

const default_content_type = "text/plain"
/**
 * Validates that a given string is a valid URL
 * @param {string} url URL to test
 * @returns 
 */
function validateUrl(url) {
    try {
        var queryUrl = new URL(url);
        //only allow https/http protocols, because protocols like javascript: and others can cause a security risk
        return queryUrl.protocol == "https:" || queryUrl.protocol == "http:"
    } catch (e) {
        return false;
    }
}
/**
 * creates a random string of a given length (see https://stackoverflow.com/a/1349426/18718228)
 * @param {number} length 
 * @returns 
 */
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
/**
 * Sends a response with the spcified statusCode, content type and data
 * res has ended after this function and cannot be written to again
 * @param {http.OutgoingMessage} res 
 * @param {string} content_type 
 * @param {number} statusCode 
 * @param {any} data 
 */
function sendResponse(res, content_type, statusCode, data) {
    if (statusCode) {
        res.statusCode = statusCode;
    }
    res.setHeader("Content-Type", content_type);
    res.end(data);
}
/**
 * Responds with a redirection package or an error message, depending if queryShortl exists in the database
 * @param {http.OutgoingMessage} res 
 * @param {Pool} pool 
 * @param {string} queryShortl 
 */
async function redirect(res, pool, queryShortl) {
    //We need to use one client for all requests during an transaction
    client = await pool.connect()
    try {
        await client.query("BEGIN");
        db_res = await client.query("SELECT url FROM shortls WHERE shortl=$1", [queryShortl]);
        if (db_res.rows.length > 0) {
            res.statusCode = 302;
            res.setHeader("Location", db_res.rows[0].url)

            await client.query("UPDATE shortls SET viewed=shortls.viewed+1 WHERE shortl=$1", [queryShortl])
            res.end();
            await client.query("COMMIT")
        } else {
            await client.query("ROLLBACK")
            sendResponse(res, default_content_type, 404, "The shortl does not exist.")
        }
    } catch (err) {
        console.error(err)
        sendResponse(res, default_content_type, 500, "An unknown Error occured. The Database threw an error")
        try {
            await client.query("ROLLBACK");
        } catch (err) {
            console.error("ROLLBACK failed.")
            console.error(err);
        }
    } finally {
        client.release()
    }
}
/**
 * Shortens the queryUrl, sends all required data to the database and returns the shortl
 * @param {string} queryUrl 
 * @param {http.OutgoingMessage} res 
 * @param {Pool} pool 
 * @returns 
 */
async function shortenUrl(res, pool, queryUrl) {
    var shortl = randomString(6);
    try {
        db_res = await pool.query(
            "INSERT INTO shortls(url,shortl,viewed,shortened) VALUES ($1,$2,0,0) \
            ON CONFLICT (url) DO UPDATE SET shortened = shortls.shortened+1 \
            RETURNING (shortl);", [queryUrl, shortl])
        sendResponse(res, MIME_TYPES[".json"], 200, JSON.stringify(db_res.rows[0]))
        return;
    } catch (err) {
        //If the error message is about the shortl key, send a accurate Error message
        if (err.detail && err.detail.includes("already exists.") && err.detail.includes("Key (shortl)=")) {
            console.log(err.detail)
            //There is a chance that this error occures. When the random functions returns an existing Key.
            //The chance for that is approximatly 1/(2*10^10)
            sendResponse(res, default_content_type, 500, "The random method generated an already exiting key. Try again.")
            return;
        } else {
            console.log(err)
            sendResponse(res, default_content_type, 500, "An unknown Server Error occured, please try again")
            return;
        }

    }
}
/**
 * Responds with all data regrding queryUrl OR shortl, if both arguments are provide, queryUrl is used.
 * @param {http.OutgoingMessage} res 
 * @param {Pool} pool 
 * @param {string|null} queryUrl 
 * @param {string|null} queryShortl 
 * @returns 
 */
async function getStats(res, pool, queryUrl, queryShortl) {
    try {
        let db_res;
        if (queryUrl !== null && queryUrl !== "") {
            //if both are set we prefer queryUrl, although this shouldn't happen and thus the behavior is undefined
            db_res = await pool.query("SELECT * FROM shortls WHERE url=$1;", [queryUrl])
        } else if (queryShortl !== "" && queryShortl !== null) {
            db_res = await pool.query("SELECT * FROM shortls WHERE shortl=$1;", [queryShortl])
        } else {
            sendResponse(res, default_content_type, 400, "Wrong parameters sent")
            return;
        }
        //sample data for api calls for stats
        if (db_res.rows.length > 0) {
            sendResponse(res, MIME_TYPES[".json"], 200, JSON.stringify(db_res.rows[0]));
            return;
        } else {
            sendResponse(res, default_content_type, 404, "The url has not been shortened yet!");
            return;
        }
    }
    catch (err) {
        console.log(err)
        sendResponse(res, default_content_type, 500, "An unknown Server Error occured, please try again");
        return;
    }
}
/**
 * Serves the index.html
 * @param {http.OutgoingMessage} res 
 */
function serveIndexHtml(res) {
    fs.readFile("./dist/index.html", function (err, data) {
        if (err) {
            //This should NEVER happen.
            sendResponse(res, default_content_type, 404, "This should NEVER happen. Please contact the server admin, the frontend files have not been found.");
            return;
        } else {
            sendResponse(res, MIME_TYPES[".html"], 200, data);
        }
    })
}
/**
 * Serves file in pathname.
 * @param {http.OutgoingMessage} res 
 * @param {string} pathname 
 */
function serveFile(res, pathname) {
    fs.readFile(pathname, function (err, data) {
        if (err) {
            sendResponse(res, default_content_type, 404, "The requested File was not found.");
            return;
        } else {
            const ext = path.parse(pathname).ext;
            var content_type = MIME_TYPES[ext];
            //If the conent type is not known, use text/plain, a undefined content type could crash the server
            if (content_type === undefined) {
                content_type = 'text/plain';
            }
            sendResponse(res, content_type, 200, data);
            return;
        }
    })
}
/**
 * Handles all requests made to the server
 * @param {http.IncomingMessage} req 
 * @param {http.OutgoingMessage} res 
 * @param {Pool} pool 
 * @returns 
 */
async function handleRequest(req, res, pool) {
    //get the full url for further parsing
    //this also resolves all path travesal attempts
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
            serveFile(res, pathname)
        } else {
            serveIndexHtml(res)
        }
    } else if (url.pathname.startsWith("/api")) {//api calls for new shortened links or stats
        if (url.pathname.startsWith("/api/stats")) {
            const queryUrl = url.searchParams.get("url");
            const queryShortl = url.searchParams.get("shortl");
            await getStats(res, pool, queryUrl, queryShortl);

        } else if (url.pathname.startsWith("/api/shorten")) {
            if (req.method !== "POST") {
                sendResponse(res, default_content_type, 405, "Only POST requests allowed")
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
                    sendResponse(res, default_content_type, 400, "The URL is invalid")
                    return;
                }
                await shortenUrl(res, pool, queryUrl);
            })
        }
    } else {
        //redirection logic
        const queryShortl = url.pathname.substring(1);
        await redirect(res, pool, queryShortl);
    }
}
module.exports = {
    handleRequest: handleRequest,
    validateUrl: validateUrl
}