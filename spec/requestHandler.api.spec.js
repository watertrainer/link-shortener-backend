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
describe("redirect logic", () => {
    let mockResponse;
    let poolQuerySpy;
    let pool;
    beforeEach(() => {
        mockResponse = httpMocks.createResponse({ eventEmitter: events.EventEmitter });
        poolQuerySpy = spyOn(Pool.prototype, "query").and.returnValue(
            Promise.resolve({ rows: [{ url: 'test_data' }] }));
        pool = new Pool();
    });
    it("should catch error safely if db throws error on redirect", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/testurl'
        });
        let clientSpyObj = jasmine.createSpyObj("Client", ["release", "query"])
        clientSpyObj.query.and.callFake(() => {
            throw new Error("The database connection was unsuccsessful")
        });
        let connectSpy = spyOn(Pool.prototype, "connect").and.returnValue(Promise.resolve(clientSpyObj));


        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(500);
            expect(mockResponse._getData()).toBe('An unknown Error occured. The Database threw an error')
            expect(connectSpy).toHaveBeenCalledTimes(1);
            done()
        });
        handler.handleRequest(mockRequest, mockResponse, pool)
    })
    it("should redirect", (done) => {

        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/testurl'
        });
        let clientSpyObj = jasmine.createSpyObj("Client", ["release", "query"])
        clientSpyObj.query.and.returnValue(Promise.resolve({ rows: [{ url: 'test_data' }] }))
        let connectSpy = spyOn(Pool.prototype, "connect").and.returnValue(Promise.resolve(clientSpyObj));
        mockResponse.on('end', () => {
            expect(mockResponse._getStatusCode()).toBe(302);
            expect(mockResponse.getHeader("Location")).toBe("test_data");
            expect(connectSpy).toHaveBeenCalledTimes(1);

            done()
        })
        handler.handleRequest(mockRequest, mockResponse, pool);
    })
})
describe("API requests to /api/stats", () => {
    let mockResponse;
    let poolQuerySpy;
    let pool;
    beforeEach(() => {
        mockResponse = httpMocks.createResponse({ eventEmitter: events.EventEmitter });
        poolQuerySpy = spyOn(Pool.prototype, "query").and.returnValue(
            Promise.resolve({ rows: [{ url: 'test_data' }] }));
        pool = new Pool();
    });
    it("should return error if has no params", (done) => {

        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/api/stats'
        });
        mockResponse.on('finish', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(400);
            expect(mockResponse._getData()).toBe('Wrong parameters sent');

            done()
        })
        handler.handleRequest(mockRequest, mockResponse, pool);
    });
    it("should send stats for requests", (done) => {

        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/api/stats?url=https://google.com'
        });
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("application/json");
            expect(mockResponse._getStatusCode()).toBe(200);
            expect(mockResponse._getData()).toBe('{"url":"test_data"}')
            expect(poolQuerySpy).toHaveBeenCalledTimes(1);

            done()
        })
        handler.handleRequest(mockRequest, mockResponse, pool);
    });


    it("should catch error safely if db throws error", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/api/stats?url=test_url'
        });

        poolQuerySpy.and.callFake(() => {
            //pg node would return an error with the detail property, so we do as well
            throw { message: "The database connection was unsuccsesful", detail: "No connection could be established" }
        });
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(500);
            expect(mockResponse._getData()).toBe('An unknown Server Error occured, please try again')
            done()
        });
        handler.handleRequest(mockRequest, mockResponse, pool)
        mockRequest.send(mockRequest.body)
    })

})
describe("API requests to /api/shorten", () => {
    let mockResponse;
    let poolQuerySpy;
    let pool;
    beforeEach(() => {
        mockResponse = httpMocks.createResponse({ eventEmitter: events.EventEmitter });
        poolQuerySpy = spyOn(Pool.prototype, "query").and.returnValue(
            Promise.resolve({ rows: [{ url: 'test_data' }] }));
        pool = new Pool();
    });
    it("should reject GET call", (done) => {

        var mockRequest = httpMocks.createRequest({
            method: 'GET',
            url: '/api/shorten'
        });
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(405);
            expect(mockResponse._getData()).toBe("Only POST requests allowed")

            done()
        })
        handler.handleRequest(mockRequest, mockResponse, pool);
    })
    it("should shorten url", (done) => {

        var mockRequest = httpMocks.createRequest({
            method: 'POST',
            url: '/api/shorten',
            body: { url: 'https://google.com' }
        });
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("application/json");
            expect(mockResponse._getStatusCode()).toBe(200);
            expect(mockResponse._getData()).toBe('{"url":"test_data"}')
            expect(poolQuerySpy).toHaveBeenCalledTimes(1);

            done()
        });
        handler.handleRequest(mockRequest, mockResponse, pool);
        mockRequest.send(mockRequest.body)
    });
    it("should catch error safely if db throws error", (done) => {
        var mockRequest = httpMocks.createRequest({
            method: 'POST',
            url: '/api/shorten',
            body: { url: "https://www.test_url.de" }
        });

        poolQuerySpy.and.callFake(() => {
            throw new Error("The database connection was unsuccsesfull");
        });
        mockResponse.on('end', () => {
            expect(mockResponse.getHeader("Content-Type")).toBe("text/plain");
            expect(mockResponse._getStatusCode()).toBe(500);
            expect(mockResponse._getData()).toBe('An unknown Server Error occured, please try again')
            done()
        });
        handler.handleRequest(mockRequest, mockResponse, pool)
        mockRequest.send(mockRequest.body)
    });
})