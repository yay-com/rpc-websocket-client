"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RpcWebSocketClient = exports.RpcVersions = void 0;
var uuid_1 = require("uuid");
var WebSocket = require('isomorphic-ws');
var RpcVersions;
(function (RpcVersions) {
    RpcVersions["RPC_VERSION"] = "2.0";
})(RpcVersions = exports.RpcVersions || (exports.RpcVersions = {}));
var RpcWebSocketClient = /** @class */ (function () {
    // constructor
    /**
     * Does not start WebSocket connection!
     * You need to call connect() method first.
     * @memberof RpcWebSocketClient
     */
    function RpcWebSocketClient() {
        this.idAwaiter = {};
        this.onOpenHandlers = [];
        this.onAnyMessageHandlers = [];
        this.onNotification = [];
        this.onRequest = [];
        this.onSuccessResponse = [];
        this.onErrorResponse = [];
        this.onErrorHandlers = [];
        this.onCloseHandlers = [];
        this.config = {
            responseTimeout: 10000,
        };
        this.ws = undefined;
    }
    // public
    /**
     * Starts WebSocket connection. Returns Promise when connection is established.
     * @param {string} url
     * @param {(string | string[])} [protocols]
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.connect = function (url, protocols) {
        this.ws = new WebSocket(url, protocols);
        return this.listen();
    };
    // events
    RpcWebSocketClient.prototype.onOpen = function (fn) {
        this.onOpenHandlers.push(fn);
    };
    /**
     * Native onMessage event. DO NOT USE THIS unless you really have to or for debugging purposes.
     * Proper RPC events are onRequest, onNotification, onSuccessResponse and onErrorResponse (or just awaiting response).
     * @param {RpcMessageEventFunction} fn
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.onAnyMessage = function (fn) {
        this.onAnyMessageHandlers.push(fn);
    };
    RpcWebSocketClient.prototype.onError = function (fn) {
        this.onErrorHandlers.push(fn);
    };
    RpcWebSocketClient.prototype.onClose = function (fn) {
        this.onCloseHandlers.push(fn);
    };
    /**
     * Appends onmessage listener on native websocket with RPC handlers.
     * If onmessage function was already there, it will call it on beggining.
     * Useful if you want to use RPC WebSocket Client on already established WebSocket along with function changeSocket().
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.listenMessages = function () {
        var _this = this;
        var previousOnMessage;
        if (this.ws.onmessage) {
            previousOnMessage = this.ws.onmessage.bind(this.ws);
        }
        this.ws.onmessage = function (e) {
            if (previousOnMessage) {
                previousOnMessage(e);
            }
            for (var _i = 0, _a = _this.onAnyMessageHandlers; _i < _a.length; _i++) {
                var handler = _a[_i];
                handler(e);
            }
            var data = JSON.parse(e.data.toString());
            if (_this.isNotification(data)) {
                // notification
                for (var _b = 0, _c = _this.onNotification; _b < _c.length; _b++) {
                    var handler = _c[_b];
                    handler(data);
                }
            }
            else if (_this.isRequest(data)) {
                // request
                for (var _d = 0, _e = _this.onRequest; _d < _e.length; _d++) {
                    var handler = _e[_d];
                    handler(data);
                }
                // responses
            }
            else if (_this.isSuccessResponse(data)) {
                // success
                for (var _f = 0, _g = _this.onSuccessResponse; _f < _g.length; _f++) {
                    var handler = _g[_f];
                    handler(data);
                }
                // resolve awaiting function
                _this.idAwaiter[data.id](data.result);
            }
            else if (_this.isErrorResponse(data)) {
                // error
                for (var _h = 0, _j = _this.onErrorResponse; _h < _j.length; _h++) {
                    var handler = _j[_h];
                    handler(data);
                }
                // resolve awaiting function
                _this.idAwaiter[data.id](data.error);
            }
        };
    };
    // communication
    /**
     * Creates and sends RPC request. Resolves when appropirate response is returned from server or after config.responseTimeout.
     * @param {string} method
     * @param {*} [params]
     * @returns
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.call = function (method, params) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var data = _this.buildRequest(method, params);
            // give limited time for response
            var timeout;
            if (_this.config.responseTimeout) {
                timeout = setTimeout(function () {
                    // stop waiting for response
                    delete _this.idAwaiter[data.id];
                    reject("Awaiting response to \"".concat(method, "\" with id: ").concat(data.id, " timed out."));
                }, _this.config.responseTimeout);
            }
            // expect response
            _this.idAwaiter[data.id] = function (responseData) {
                // stop timeout
                clearInterval(timeout);
                // stop waiting for response
                delete _this.idAwaiter[data.id];
                if (_this.isRpcError(responseData)) {
                    reject(responseData);
                    return;
                }
                resolve(responseData);
            };
            var json = JSON.stringify(data);
            _this.ws.send(json);
        });
    };
    /**
     * Creates and sends RPC Notification.
     * @param {string} method
     * @param {*} [params]
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.notify = function (method, params) {
        this.ws.send(JSON.stringify(this.buildNotification(method, params)));
    };
    // setup
    /**
     * You can provide custom id generation function to replace default uuid/v1.
     * @param {() => string} idFn
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.customId = function (idFn) {
        this.idFn = idFn;
    };
    /**
     * Removed jsonrpc from sent messages. Good if you don't care about standards or need better performance.
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.noRpc = function () {
        this.buildRequest = this.buildRequestBase;
        this.buildNotification = this.buildNotificationBase;
        this.buildRpcSuccessResponse = this.buildRpcSuccessResponseBase;
        this.buildRpcErrorResponse = this.buildRpcErrorResponseBase;
    };
    /**
     * Allows modifying configuration.
     * @param {RpcWebSocketConfig} options
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.configure = function (options) {
        Object.assign(this.config, options);
    };
    /**
     * Allows you to change used native WebSocket client to another one.
     * If you have already-connected WebSocket, use this with listenMessages().
     * @param {WebSocket} ws
     * @memberof RpcWebSocketClient
     */
    RpcWebSocketClient.prototype.changeSocket = function (ws) {
        this.ws = ws;
    };
    // private
    // events
    RpcWebSocketClient.prototype.listen = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.ws.onopen = function (e) {
                for (var _i = 0, _a = _this.onOpenHandlers; _i < _a.length; _i++) {
                    var handler = _a[_i];
                    handler(e);
                }
                resolve(e);
            };
            // listen for messages
            _this.listenMessages();
            // called before onclose
            _this.ws.onerror = function (e) {
                for (var _i = 0, _a = _this.onErrorHandlers; _i < _a.length; _i++) {
                    var handler = _a[_i];
                    handler(e);
                }
            };
            _this.ws.onclose = function (e) {
                for (var _i = 0, _a = _this.onCloseHandlers; _i < _a.length; _i++) {
                    var handler = _a[_i];
                    handler(e);
                }
                reject(e);
            };
        });
    };
    // request
    RpcWebSocketClient.prototype.buildRequest = function (method, params) {
        var data = this.buildRequestBase(method, params);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    };
    RpcWebSocketClient.prototype.buildRequestBase = function (method, params) {
        var data = {};
        data.id = this.idFn();
        data.method = method;
        if (params) {
            data.params = params;
        }
        return data;
    };
    // notification
    RpcWebSocketClient.prototype.buildNotification = function (method, params) {
        var data = this.buildNotificationBase(method, params);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    };
    RpcWebSocketClient.prototype.buildNotificationBase = function (method, params) {
        var data = {};
        data.method = method;
        if (params) {
            data.params = params;
        }
        return data;
    };
    // success response
    RpcWebSocketClient.prototype.buildRpcSuccessResponse = function (id, result) {
        var data = this.buildRpcSuccessResponseBase(id, result);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    };
    RpcWebSocketClient.prototype.buildRpcSuccessResponseBase = function (id, result) {
        var data = {};
        data.id = id;
        data.result = result;
        return data;
    };
    // error response
    RpcWebSocketClient.prototype.buildRpcErrorResponse = function (id, error) {
        var data = this.buildRpcErrorResponseBase(id, error);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    };
    RpcWebSocketClient.prototype.buildRpcErrorResponseBase = function (id, error) {
        var data = {};
        data.id = id;
        data.error = error;
        return data;
    };
    RpcWebSocketClient.prototype.idFn = function () {
        return (0, uuid_1.v4)();
    };
    // tests
    RpcWebSocketClient.prototype.isNotification = function (data) {
        return !data.id;
    };
    RpcWebSocketClient.prototype.isRequest = function (data) {
        return data.method;
    };
    RpcWebSocketClient.prototype.isSuccessResponse = function (data) {
        return data.hasOwnProperty("result");
    };
    RpcWebSocketClient.prototype.isErrorResponse = function (data) {
        return data.hasOwnProperty("error");
    };
    RpcWebSocketClient.prototype.isRpcError = function (data) {
        return typeof (data === null || data === void 0 ? void 0 : data.code) !== 'undefined';
    };
    return RpcWebSocketClient;
}());
exports.RpcWebSocketClient = RpcWebSocketClient;
//# sourceMappingURL=rpc-websocket-client.js.map