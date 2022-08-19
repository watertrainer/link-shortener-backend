const handler = require("../requestHandler");
var httpMocks = require('node-mocks-http');
var events = require('events');
var fs = require('fs');
const { Pool, Client, PoolClient } = require('pg')
const { doesNotMatch } = require("assert");
const { callbackify } = require("util");
const { EventEmitter } = require("stream");
describe("Validate Urls", () => {
    it("should accept with protocol", () => {
        expect(handler.validateUrl("http://google.com")).withContext("with http").toBeTrue();
        expect(handler.validateUrl("https://google.com")).withContext("with https").toBeTrue();
        expect(handler.validateUrl("http://www.google.com")).withContext("with www.").toBeTrue();
        expect(handler.validateUrl("https://google.de")).withContext("with https and .de, without www").toBeTrue();
        expect(handler.validateUrl("https://www.google.com")).withContext("with https, www and de").toBeTrue();
    })
    it("should not accept without protocol", () => {
        expect(handler.validateUrl("www.google.com")).withContext("with www, .com").toBeFalse();
        expect(handler.validateUrl("google.com")).withContext("without www, with .com").toBeFalse();
        expect(handler.validateUrl("google.de")).withContext("without www, with .de").toBeFalse();
        expect(handler.validateUrl("www.google.de")).withContext("with www, .de").toBeFalse();
    })
    // exerpt from https://en.wikipedia.org/wiki/List_of_URI_schemes
    //If this would be enabled it might cause security implications, because you cannot see what cod/protocol a shortened link might trigger
    it("should not accept with different protocols", () => {
        expect(handler.validateUrl("javascript:void(0)")).withContext("javascript").toBeFalse();
        expect(handler.validateUrl("jdbc:oracle:oci:@host:port(555)")).withContext("java database connection").toBeFalse();
        expect(handler.validateUrl("slack://open?team={5}")).withContext("slack").toBeFalse();
        expect(handler.validateUrl("zoommtg://zoom.us/join?confno=50")).withContext("zoom meeting").toBeFalse();
    })
})

describe("Server request handler", () => {
    let mockResponse;
    let fsSpy;
    let fsFileExistsSpy;
    beforeEach(() => {
        mockResponse = httpMocks.createResponse({ eventEmitter: events.EventEmitter });
        fsSpy = spyOn(fs, "readFile").and.callFake((path, callback) => {
            setTimeout(() => callback(null, Buffer.from("test_value")));

        })
        fsFileExistsSpy = spyOn(fs, "existsSync").and.returnValue(true);
    });
    it("should redirect on root request", () => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/',
            params: {
                url: "test"
            }
        });
        handler.handleRequest(mockRequest, mockResponse);
        expect(mockResponse.getHeader("Location")).toBe("/home");
        expect(mockResponse.statusCode).toBe(302);
    });
    it("should serve html on /home/", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/home/'
        })
        handler.handleRequest(mockRequest, mockResponse);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/html");
            expect(mockResponse._getStatusCode()).toBe(200);
            //Because we're sending a buffer we have to decode it (usually httpClient does that)
            expect(mockResponse._getBuffer().toString()).toBe("test_value")
            expect(fsSpy).toHaveBeenCalledTimes(1);
            done()
        })
    });
    it("should serve html on /home", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/home'
        })

        handler.handleRequest(mockRequest, mockResponse);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/html");
            expect(mockResponse._getStatusCode()).toBe(200);
            //Because we're sending a buffer we have to decode it (usually httpClient does that)
            expect(mockResponse._getBuffer().toString()).toBe("test_value")
            expect(fsSpy).toHaveBeenCalledTimes(1);

            done()
        })
    });
    it("should return error on filesystem failure", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/home'
        })
        fsSpy.and.callFake((path, callback) => {
            setTimeout(() => callback("File not Found"));

        })
        handler.handleRequest(mockRequest, mockResponse);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(404);
            expect(mockResponse._getData()).toBe("This should NEVER happen. Please contact the server admin, the frontend files have not been found.")
            expect(fsSpy).toHaveBeenCalledTimes(1);

            done()
        })
    });
    it("should serve js on request", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/home/dist.js'
        })

        handler.handleRequest(mockRequest, mockResponse);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/javascript");
            expect(mockResponse._getStatusCode()).toBe(200);
            //Because we're sending a buffer we have to decode it (usually httpClient does that)
            expect(mockResponse._getBuffer().toString()).toBe("test_value")
            expect(fsSpy).toHaveBeenCalledTimes(1);

            done()
        })
    });
    it("should return index.html if file doesnt exist", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/home/dist.js'
        })
        fsFileExistsSpy.and.returnValue(false);
        handler.handleRequest(mockRequest, mockResponse);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/html");
            expect(mockResponse._getStatusCode()).toBe(200);
            //Because we're sending a buffer we have to decode it (usually httpClient does that)
            expect(mockResponse._getBuffer().toString()).toBe("test_value")
            expect(fsSpy).toHaveBeenCalledTimes(1);

            done()
        })
    });
    it("should return 404 on file system error", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/home/dist.js'
        })
        fsSpy.and.callFake((path, callback) => {
            setTimeout(() => callback("File not Found"));

        })
        handler.handleRequest(mockRequest, mockResponse);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(404);
            expect(mockResponse._getData()).toBe("The requested File was no found.")
            expect(fsSpy).toHaveBeenCalledTimes(1);

            done()
        })
    });



});
describe("API requests", () => {
    let mockResponse;
    let poolQuerySpy;
    let pool;
    beforeEach(() => {
        mockResponse = httpMocks.createResponse({ eventEmitter: events.EventEmitter });
        poolQuerySpy = spyOn(Pool.prototype, "query").and.returnValue(
            Promise.resolve({ rows: [{ url: 'test_data' }] }));
        pool = new Pool();
    });
    it("should send stats for requests to /api/stats", (done) => {

        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/api/stats?url=https://google.com'
        });
        handler.handleRequest(mockRequest, mockResponse, pool);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("application/json");
            expect(mockResponse._getStatusCode()).toBe(200);
            expect(mockResponse._getData()).toBe('{"url":"test_data"}')
            expect(poolQuerySpy).toHaveBeenCalledTimes(1);

            done()
        })
    }); it("should reject GET call to /api/shortened", () => {

        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/api/shorten'
        });
        handler.handleRequest(mockRequest, mockResponse, pool);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(405);
            expect(mockResponse._getData()).toBe("Only POST requests allowed")
            expect(fsSpy).toHaveBeenCalledTimes(1);

            done()
        })
    })
    it("should shorten url sent to /api/shorten", (done) => {

        var mockRequest = httpMocks.createRequest({
            method: 'POST',
            url: '/api/shorten',
            body: { url: 'https://google.com' }
        });
        handler.handleRequest(mockRequest, mockResponse, pool);
        mockRequest.send(mockRequest.body)
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("application/json");
            expect(mockResponse._getStatusCode()).toBe(200);
            expect(mockResponse._getData()).toBe('{"url":"test_data"}')
            expect(poolQuerySpy).toHaveBeenCalledTimes(1);

            done()
        })
    })
})