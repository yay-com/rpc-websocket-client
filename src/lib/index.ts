import { v1 } from 'uuid';

export type RpcEventFunction = (e: Event) => void;
export type RpcMessageEventFunction = (e: MessageEvent) => void;
export type RpcCloseEventFunction = (e: CloseEvent) => void;
export type RpcId = string | number;

export type RpcNotificationEvent = (data: RpcNotification) => void;
export type RpcRequestEvent = (data: RpcRequest) => void;
export type RpcSuccessResponseEvent = (data: RpcSuccessResponse) => void;
export type RpcErrorResponseEvent = (data: RpcErrorResponse) => void;

export enum RpcVersions {
    RPC_VERSION = '2.0',
}

export interface RpcData {
    method: string;
    params?: any;
}

export interface RpcNotification extends RpcData {
    jsonrpc: RpcVersions.RPC_VERSION;
}

export interface RpcRequest extends RpcNotification {
    // if not included its notification
    id: RpcId;
}

export interface RpcResponse {
    id: RpcId;
    jsonrpc: RpcVersions.RPC_VERSION;
}

export interface RpcSuccessResponse extends RpcResponse {
    // if not included its notification
    result: string;
}

export interface RpcError extends RpcResponse {
    code: number;
    message: string;
    data?: any;
}

export interface RpcErrorResponse extends RpcResponse {
    error: RpcError;
}

export interface RpcWebSocketConfig {
    responseTimeout: number;
}

export type RpcUnidentifiedMessage = RpcRequest | RpcNotification | RpcSuccessResponse | RpcErrorResponse;

export class RpcWebSocketClient {
    private ws: WebSocket;
    private idAwaiter: {
        [id: string]: () => void;
    } = {};

    private onOpenHandlers: RpcEventFunction[] = [];
    private onAnyMessageHandlers: RpcMessageEventFunction[] = [];

    private onNotification: RpcNotificationEvent[] = [];
    private onRequest: RpcRequestEvent[] = [];
    private onSuccessResponse: RpcSuccessResponseEvent[] = [];
    private onErrorResponse: RpcErrorResponseEvent[] = [];

    private onErrorHandlers: RpcEventFunction[] = [];
    private onCloseHandlers: RpcCloseEventFunction[] = [];

    private config: RpcWebSocketConfig = {
        responseTimeout: 10000,
    };

    // constructor
    /**
     * Does not start WebSocket connection!
     * You need to call connect() method first.
     * @memberof RpcWebSocketClient
     */
    public constructor() {
        this.ws = undefined as any;
    }

    // public
    /**
     * Starts WebSocket connection. Returns Promise when connection is established.
     * @param {string} url
     * @param {(string | string[])} [protocols]
     * @memberof RpcWebSocketClient
     */
    public async connect(url: string, protocols?: string | string[]) {
        this.ws = new WebSocket(url, protocols);
        await this.listen();
    }

    // events
    public onOpen(fn: RpcEventFunction) {
        this.onOpenHandlers.push(fn);
    }

    /**
     * Native onMessage event. DO NOT USE THIS unless you really have to or for debugging purposes.
     * Proper RPC events are onRequest, onNotification, onSuccessResponse and onErrorResponse (or just awaiting response).
     * @param {RpcMessageEventFunction} fn
     * @memberof RpcWebSocketClient
     */
    public onAnyMessage(fn: RpcMessageEventFunction) {
        this.onAnyMessageHandlers.push(fn);
    }

    public onError(fn: RpcEventFunction) {
        this.onErrorHandlers.push(fn);
    }

    public onClose(fn: RpcCloseEventFunction) {
        this.onCloseHandlers.push(fn);
    }

    /**
     * Appends onmessage listener on native websocket with RPC handlers.
     * If onmessage function was already there, it will call it on beggining.
     * Useful if you want to use RPC WebSocket Client on already established WebSocket along with function changeSocket().
     * @memberof RpcWebSocketClient
     */
    public listenMessages() {
        let previousOnMessage: RpcEventFunction | undefined;
        if (this.ws.onmessage) {
            previousOnMessage = this.ws.onmessage.bind(this.ws);
        }

        this.ws.onmessage = (e: MessageEvent) => {
            if (previousOnMessage) {
                previousOnMessage(e);
            }

            for (const handler of this.onAnyMessageHandlers) {
                handler(e);
            }

            const data: RpcUnidentifiedMessage = JSON.parse(e.data);
            if (this.isNotification(data)) {
                // notification
                for (const handler of this.onNotification) {
                    handler(data);
                }
            } else if (this.isRequest(data)) {
                // request
                for (const handler of this.onRequest) {
                    handler(data);
                }
                // responses
            } else if (this.isSuccessResponse(data)) {
                // success
                for (const handler of this.onSuccessResponse) {
                    handler(data);
                }

                // resolve awaiting function
                this.idAwaiter[data.id]();
            } else if (this.isErrorResponse(data)) {
                // error
                for (const handler of this.onErrorResponse) {
                    handler(data);
                }

                // resolve awaiting function
                this.idAwaiter[data.id]();
            }
        };
    }

    // communication

    /**
     * Creates and sends RPC request. Resolves when appropirate response is returned from server or after config.responseTimeout.
     * @param {string} method
     * @param {*} [params]
     * @returns
     * @memberof RpcWebSocketClient
     */
    public call(method: string, params?: any) {
        return new Promise((resolve, reject) => {
            const data = this.buildRequest(method, params);

            // give limited time for response
            let timeout: NodeJS.Timeout;
            if (this.config.responseTimeout) {
                timeout = setTimeout(() => {
                    // stop waiting for response
                    delete this.idAwaiter[data.id];
                    reject(`Awaiting response to: ${method} with id: ${data.id} timed out.`);
                }, this.config.responseTimeout);
            }

            // expect response
            this.idAwaiter[data.id] = () => {
                // stop timeout
                clearInterval(timeout);
                // stop waiting for response
                delete this.idAwaiter[data.id];
                resolve();
            };

            this.ws.send(JSON.stringify(data));
        });
    }

    /**
     * Creates and sends RPC Notification.
     * @param {string} method
     * @param {*} [params]
     * @memberof RpcWebSocketClient
     */
    public notify(method: string, params?: any) {
        this.ws.send(JSON.stringify(this.buildNotification(method, params)));
    }

    // setup

    /**
     * You can provide custom id generation function to replace default uuid/v1.
     * @param {() => string} idFn
     * @memberof RpcWebSocketClient
     */
    public customId(idFn: () => string) {
        this.idFn = idFn;
    }

    /**
     * Removed jsonrpc from sent messages. Good if you don't care about standards or need better performance.
     * @memberof RpcWebSocketClient
     */
    public noRpc() {
        this.buildRequest = this.buildRequestBase;
        this.buildNotification = this.buildNotificationBase;
        this.buildRpcSuccessResponse = this.buildRpcSuccessResponseBase;
        this.buildRpcErrorResponse = this.buildRpcErrorResponseBase;
    }

    /**
     * Allows modifying configuration.
     * @param {RpcWebSocketConfig} options
     * @memberof RpcWebSocketClient
     */
    public configure(options: RpcWebSocketConfig) {
        Object.assign(this.config, options);
    }

    /**
     * Allows you to change used native WebSocket client to another one.
     * If you have already-connected WebSocket, use this with listenMessages().
     * @param {WebSocket} ws
     * @memberof RpcWebSocketClient
     */
    public changeSocket(ws: WebSocket) {
        this.ws = ws;
    }

    // private

    // events
    private listen() {
        return new Promise((resolve, reject) => {
            this.ws.onopen = (e: Event) => {
                for (const handler of this.onOpenHandlers) {
                    handler(e);
                }
                resolve();
            };

            // listen for messages
            this.listenMessages();

            // called before onclose
            this.ws.onerror = (e: Event) => {
                for (const handler of this.onErrorHandlers) {
                    handler(e);
                }
            };

            this.ws.onclose = (e: CloseEvent) => {
                for (const handler of this.onCloseHandlers) {
                    handler(e);
                }
                reject();
            };
        });
    }

    // request
    private buildRequest(method: string, params?: any): RpcRequest {
        const data = this.buildRequestBase(method, params);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    }

    private buildRequestBase(method: string, params?: any): RpcRequest {
        const data: RpcRequest = {} as any;
        data.id = this.idFn();
        data.method = method;

        if (params) {
            data.params = params;
        }

        return data;
    }

    // notification
    private buildNotification(method: string, params?: any): RpcNotification {
        const data = this.buildNotificationBase(method, params);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    }

    private buildNotificationBase(method: string, params?: any): RpcNotification {
        const data: RpcNotification = {} as any;
        data.method = method;

        if (params) {
            data.params = params;
        }

        return data;
    }

    // success response
    private buildRpcSuccessResponse(id: RpcId, result: any): RpcSuccessResponse {
        const data = this.buildRpcSuccessResponseBase(id, result);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    }

    private buildRpcSuccessResponseBase(id: RpcId, result: any): RpcSuccessResponse {
        const data: RpcSuccessResponse = {} as any;
        data.id = id;
        data.result = result;
        return data;
    }

    // error response
    private buildRpcErrorResponse(id: RpcId, error: RpcError): RpcErrorResponse {
        const data = this.buildRpcErrorResponseBase(id, error);
        data.jsonrpc = RpcVersions.RPC_VERSION;
        return data;
    }

    private buildRpcErrorResponseBase(id: RpcId, error: RpcError): RpcErrorResponse {
        const data: RpcErrorResponse = {} as any;
        data.id = id;
        data.error = error;
        return data;
    }

    private idFn(): RpcId {
        return v1();
    }

    // tests
    private isNotification(data: RpcUnidentifiedMessage): data is RpcNotification {
        return !(data as any).id;
    }

    private isRequest(data: RpcUnidentifiedMessage): data is RpcRequest {
        return (data as any).method;
    }

    private isSuccessResponse(data: RpcUnidentifiedMessage): data is RpcSuccessResponse {
        return (data as any).result;
    }

    private isErrorResponse(data: RpcUnidentifiedMessage): data is RpcErrorResponse {
        return (data as any).error;
    }
}

export default RpcWebSocketClient;

(async () => {
    const rpc = new RpcWebSocketClient();
    // rpc.changeSocket(ws);

    // rpc.onMessage((e) => {
    //     //
    // });

    await rpc.connect('ws://localhost:4000');

})();