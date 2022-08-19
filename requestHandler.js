const http = require('http');
const fs = require('fs');
const path = require('path'); const { Pool } = require('pg')
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
async function handleRequest(req, res) {
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
        } else {
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
    } else if (url.startsWith("/api")) {
        //api calls for new shortened links or stats
        res.statusCode = 501;
        res.setHeader('Content-Type', 'text/plain');
        res.end("Not implemented yet");
    } else {
        //redirection logic/404 page
        res.statusCode = 501;
        res.setHeader('Content-Type', 'text/plain');
        res.end("Not implemented yet");
    }
} else {
    //redirection logic
}
module.exports = {
    handleRequest: handleRequest,
    validateUrl: validateUrl
}