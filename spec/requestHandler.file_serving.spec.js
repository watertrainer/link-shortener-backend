const handler = require("../requestHandler");
var httpMocks = require('node-mocks-http');
var events = require('events');
var fs = require('fs');


describe("Server request handler frontend calls", () => {
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
    it("should redirect on root request", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/',
            params: {
                url: "test"
            }
        });
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Location")).toBe("/home");
            expect(mockResponse.statusCode).toBe(302); done()
        });
        handler.handleRequest(mockRequest, mockResponse);
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
    }); it("should serve plain on none existent file extension", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/home/dist'
        })

        handler.handleRequest(mockRequest, mockResponse);
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
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
            expect(mockResponse._getData()).toBe("The requested File was not found.")
            expect(fsSpy).toHaveBeenCalledTimes(1);

            done()
        })
    });



});