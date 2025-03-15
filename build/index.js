#!/usr/bin/env node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const index_js_1 = require("@modelcontextprotocol/sdk/server/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/server/stdio.js");
const types_js_1 = require("@modelcontextprotocol/sdk/types.js");
const axios_1 = __importDefault(require("axios"));
const ws_1 = __importDefault(require("ws"));
// WebSocket realtime data cache
class OKXWebSocketClient {
    ws = null;
    subscriptions = new Set();
    dataCache = new Map();
    connectionAttempts = 0;
    maxConnectionAttempts = 5;
    reconnectDelay = 5000;
    pingInterval = null;
    isConnecting = false;
    constructor() {
        this.connect();
    }
    connect() {
        if (this.isConnecting)
            return;
        this.isConnecting = true;
        if (this.connectionAttempts >= this.maxConnectionAttempts) {
            console.error("[WebSocket] Max connection attempts reached. Giving up.");
            return;
        }
        console.error(`[WebSocket] Connecting to OKX (attempt ${this.connectionAttempts + 1}/${this.maxConnectionAttempts})...`);
        this.ws = new ws_1.default("wss://ws.okx.com:8443/ws/v5/public");
        this.ws.on("open", () => {
            console.error("[WebSocket] Connected to OKX WebSocket");
            this.connectionAttempts = 0;
            this.isConnecting = false;
            this.resubscribe();
            // Set up ping interval to keep connection alive
            if (this.pingInterval)
                clearInterval(this.pingInterval);
            this.pingInterval = setInterval(() => this.ping(), 30000);
        });
        this.ws.on("message", (data) => {
            try {
                const message = JSON.parse(data.toString());
                // Handle ping response
                if (message.event === "pong") {
                    return;
                }
                // Handle data updates
                if (message.data && message.arg) {
                    const key = `${message.arg.channel}:${message.arg.instId}`;
                    this.dataCache.set(key, message.data);
                    console.error(`[WebSocket] Received update for ${key}`);
                }
            }
            catch (error) {
                console.error("[WebSocket] Error parsing message:", error);
            }
        });
        this.ws.on("error", (error) => {
            console.error("[WebSocket] Error:", error);
        });
        this.ws.on("close", () => {
            console.error("[WebSocket] Disconnected");
            this.isConnecting = false;
            if (this.pingInterval) {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            }
            this.connectionAttempts++;
            setTimeout(() => this.connect(), this.reconnectDelay);
        });
    }
    ping() {
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify({ op: "ping" }));
        }
    }
    resubscribe() {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        for (const subscription of this.subscriptions) {
            const [channel, instId] = subscription.split(":");
            this.sendSubscription(channel, instId);
            console.error(`[WebSocket] Resubscribed to ${channel} for ${instId}`);
        }
    }
    sendSubscription(channel, instId) {
        if (!this.ws || this.ws.readyState !== ws_1.default.OPEN)
            return;
        this.ws.send(JSON.stringify({
            op: "subscribe",
            args: [
                {
                    channel,
                    instId,
                },
            ],
        }));
    }
    subscribe(channel, instId) {
        const key = `${channel}:${instId}`;
        if (this.subscriptions.has(key)) {
            return; // Already subscribed
        }
        console.error(`[WebSocket] Subscribing to ${channel} for ${instId}`);
        this.subscriptions.add(key);
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.sendSubscription(channel, instId);
        }
    }
    unsubscribe(channel, instId) {
        const key = `${channel}:${instId}`;
        if (!this.subscriptions.has(key)) {
            return; // Not subscribed
        }
        console.error(`[WebSocket] Unsubscribing from ${channel} for ${instId}`);
        this.subscriptions.delete(key);
        if (this.ws && this.ws.readyState === ws_1.default.OPEN) {
            this.ws.send(JSON.stringify({
                op: "unsubscribe",
                args: [
                    {
                        channel,
                        instId,
                    },
                ],
            }));
        }
    }
    getLatestData(channel, instId) {
        const key = `${channel}:${instId}`;
        return this.dataCache.get(key) || null;
    }
    isSubscribed(channel, instId) {
        const key = `${channel}:${instId}`;
        return this.subscriptions.has(key);
    }
    close() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        if (this.ws) {
            this.ws.terminate();
            this.ws = null;
        }
        this.subscriptions.clear();
        this.dataCache.clear();
    }
}
class OKXServer {
    server;
    axiosInstance;
    wsClient;
    constructor() {
        console.error("[Setup] Initializing OKX MCP server...");
        this.server = new index_js_1.Server({
            name: "okx-mcp-server",
            version: "0.2.0",
        }, {
            capabilities: {
                tools: {},
            },
        });
        this.axiosInstance = axios_1.default.create({
            baseURL: "https://www.okx.com/api/v5",
            timeout: 5000,
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
        });
        // Initialize WebSocket client
        this.wsClient = new OKXWebSocketClient();
        this.setupToolHandlers();
        this.server.onerror = (error) => console.error("[Error]", error);
        process.on("SIGINT", async () => {
            await this.cleanup();
            process.exit(0);
        });
    }
    async cleanup() {
        console.error("[Cleanup] Shutting down...");
        this.wsClient.close();
        await this.server.close();
    }
    setupToolHandlers() {
        this.server.setRequestHandler(types_js_1.ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "get_price",
                    description: "Get latest price for an OKX instrument with formatted visualization",
                    inputSchema: {
                        type: "object",
                        properties: {
                            instrument: {
                                type: "string",
                                description: "Instrument ID (e.g. BTC-USDT)",
                            },
                            format: {
                                type: "string",
                                description: "Output format (json or markdown)",
                                default: "markdown",
                            },
                        },
                        required: ["instrument"],
                    },
                },
                {
                    name: "get_candlesticks",
                    description: "Get candlestick data for an OKX instrument with visualization options",
                    inputSchema: {
                        type: "object",
                        properties: {
                            instrument: {
                                type: "string",
                                description: "Instrument ID (e.g. BTC-USDT)",
                            },
                            bar: {
                                type: "string",
                                description: "Time interval (e.g. 1m, 5m, 1H, 1D)",
                                default: "1m",
                            },
                            limit: {
                                type: "number",
                                description: "Number of candlesticks (max 100)",
                                default: 100,
                            },
                            format: {
                                type: "string",
                                description: "Output format (json, markdown, or table)",
                                default: "markdown",
                            },
                        },
                        required: ["instrument"],
                    },
                },
                {
                    name: "subscribe_ticker",
                    description: "Subscribe to real-time ticker updates for an instrument",
                    inputSchema: {
                        type: "object",
                        properties: {
                            instrument: {
                                type: "string",
                                description: "Instrument ID (e.g. BTC-USDT)",
                            },
                        },
                        required: ["instrument"],
                    },
                },
                {
                    name: "get_live_ticker",
                    description: "Get the latest ticker data from WebSocket subscription",
                    inputSchema: {
                        type: "object",
                        properties: {
                            instrument: {
                                type: "string",
                                description: "Instrument ID (e.g. BTC-USDT)",
                            },
                            format: {
                                type: "string",
                                description: "Output format (json or markdown)",
                                default: "markdown",
                            },
                        },
                        required: ["instrument"],
                    },
                },
                {
                    name: "unsubscribe_ticker",
                    description: "Unsubscribe from real-time ticker updates for an instrument",
                    inputSchema: {
                        type: "object",
                        properties: {
                            instrument: {
                                type: "string",
                                description: "Instrument ID (e.g. BTC-USDT)",
                            },
                        },
                        required: ["instrument"],
                    },
                },
            ],
        }));
        this.server.setRequestHandler(types_js_1.CallToolRequestSchema, async (request) => {
            try {
                const validTools = [
                    "get_price",
                    "get_candlesticks",
                    "subscribe_ticker",
                    "get_live_ticker",
                    "unsubscribe_ticker",
                ];
                if (!validTools.includes(request.params.name)) {
                    throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
                }
                const args = request.params.arguments;
                if (!args.instrument) {
                    throw new types_js_1.McpError(types_js_1.ErrorCode.InvalidParams, "Missing required parameter: instrument");
                }
                // Default format to markdown if not specified
                args.format = args.format || "markdown";
                // Handle WebSocket subscriptions
                if (request.params.name === "subscribe_ticker") {
                    console.error(`[WebSocket] Subscribing to ticker for ${args.instrument}`);
                    this.wsClient.subscribe("tickers", args.instrument);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Successfully subscribed to real-time ticker updates for ${args.instrument}. Use get_live_ticker to retrieve the latest data.`,
                            },
                        ],
                    };
                }
                // Handle WebSocket unsubscriptions
                if (request.params.name === "unsubscribe_ticker") {
                    console.error(`[WebSocket] Unsubscribing from ticker for ${args.instrument}`);
                    this.wsClient.unsubscribe("tickers", args.instrument);
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Successfully unsubscribed from real-time ticker updates for ${args.instrument}.`,
                            },
                        ],
                    };
                }
                // Handle WebSocket data retrieval
                if (request.params.name === "get_live_ticker") {
                    const isSubscribed = this.wsClient.isSubscribed("tickers", args.instrument);
                    if (!isSubscribed) {
                        console.error(`[WebSocket] Auto-subscribing to ticker for ${args.instrument}`);
                        this.wsClient.subscribe("tickers", args.instrument);
                        // Give it a moment to connect and receive data
                        await new Promise((resolve) => setTimeout(resolve, 1000));
                    }
                    const tickerData = this.wsClient.getLatestData("tickers", args.instrument);
                    if (!tickerData || tickerData.length === 0) {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `No live data available yet for ${args.instrument}. If you just subscribed, please wait a moment and try again.`,
                                },
                            ],
                        };
                    }
                    const ticker = tickerData[0];
                    if (args.format === "json") {
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(ticker, null, 2),
                                },
                            ],
                        };
                    }
                    else {
                        // Calculate change for markdown formatting
                        const last = parseFloat(ticker.last);
                        const open24h = parseFloat(ticker.open24h);
                        const priceChange = last - open24h;
                        const priceChangePercent = (priceChange / open24h) * 100;
                        const changeSymbol = priceChange >= 0 ? "▲" : "▼";
                        // Create price range visual
                        const low24h = parseFloat(ticker.low24h);
                        const high24h = parseFloat(ticker.high24h);
                        const range = high24h - low24h;
                        const position = Math.min(Math.max((last - low24h) / range, 0), 1) * 100;
                        const priceBar = `Low ${low24h.toFixed(2)} [${"▮".repeat(Math.floor(position / 5))}|${"▯".repeat(20 - Math.floor(position / 5))}] ${high24h.toFixed(2)} High`;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `# ${args.instrument} Live Price Data\n\n` +
                                        `## Current Price: $${last.toLocaleString()}\n\n` +
                                        `**24h Change:** ${changeSymbol} $${Math.abs(priceChange).toLocaleString()} (${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(2)}%)\n\n` +
                                        `**Bid:** $${parseFloat(ticker.bidPx).toLocaleString()} | **Ask:** $${parseFloat(ticker.askPx).toLocaleString()}\n\n` +
                                        `### 24-Hour Price Range\n\n` +
                                        `\`\`\`\n${priceBar}\n\`\`\`\n\n` +
                                        `**24h High:** $${parseFloat(ticker.high24h).toLocaleString()}\n` +
                                        `**24h Low:** $${parseFloat(ticker.low24h).toLocaleString()}\n\n` +
                                        `**24h Volume:** ${parseFloat(ticker.vol24h).toLocaleString()} units\n\n` +
                                        `**Last Updated:** ${new Date(parseInt(ticker.ts)).toLocaleString()}\n\n` +
                                        `*Data source: Live WebSocket feed*`,
                                },
                            ],
                        };
                    }
                }
                if (request.params.name === "get_price") {
                    console.error(`[API] Fetching price for instrument: ${args.instrument}`);
                    const response = await this.axiosInstance.get("/market/ticker", {
                        params: { instId: args.instrument },
                    });
                    if (response.data.code !== "0") {
                        throw new Error(`OKX API error: ${response.data.msg}`);
                    }
                    if (!response.data.data || response.data.data.length === 0) {
                        throw new Error("No data returned from OKX API");
                    }
                    const ticker = response.data.data[0];
                    if (args.format === "json") {
                        // Original JSON format
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify({
                                        instrument: ticker.instId,
                                        lastPrice: ticker.last,
                                        bid: ticker.bidPx,
                                        ask: ticker.askPx,
                                        high24h: ticker.high24h,
                                        low24h: ticker.low24h,
                                        volume24h: ticker.vol24h,
                                        timestamp: new Date(parseInt(ticker.ts)).toISOString(),
                                    }, null, 2),
                                },
                            ],
                        };
                    }
                    else {
                        // Enhanced markdown format with visualization elements
                        const priceChange = parseFloat(ticker.last) - parseFloat(ticker.open24h);
                        const priceChangePercent = (priceChange / parseFloat(ticker.open24h)) * 100;
                        const changeSymbol = priceChange >= 0 ? "▲" : "▼";
                        const changeColor = priceChange >= 0 ? "green" : "red";
                        // Create price range visual
                        const low24h = parseFloat(ticker.low24h);
                        const high24h = parseFloat(ticker.high24h);
                        const range = high24h - low24h;
                        const currentPrice = parseFloat(ticker.last);
                        const position = Math.min(Math.max((currentPrice - low24h) / range, 0), 1) * 100;
                        const priceBar = `Low ${low24h.toFixed(2)} [${"▮".repeat(Math.floor(position / 5))}|${"▯".repeat(20 - Math.floor(position / 5))}] ${high24h.toFixed(2)} High`;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: `# ${ticker.instId} Price Summary\n\n` +
                                        `## Current Price: $${parseFloat(ticker.last).toLocaleString()}\n\n` +
                                        `**24h Change:** ${changeSymbol} $${Math.abs(priceChange).toLocaleString()} (${priceChangePercent >= 0 ? "+" : ""}${priceChangePercent.toFixed(2)}%)\n\n` +
                                        `**Bid:** $${parseFloat(ticker.bidPx).toLocaleString()} | **Ask:** $${parseFloat(ticker.askPx).toLocaleString()}\n\n` +
                                        `### 24-Hour Price Range\n\n` +
                                        `\`\`\`\n${priceBar}\n\`\`\`\n\n` +
                                        `**24h High:** $${parseFloat(ticker.high24h).toLocaleString()}\n` +
                                        `**24h Low:** $${parseFloat(ticker.low24h).toLocaleString()}\n\n` +
                                        `**24h Volume:** ${parseFloat(ticker.vol24h).toLocaleString()} units\n\n` +
                                        `**Last Updated:** ${new Date(parseInt(ticker.ts)).toLocaleString()}\n\n` +
                                        `*Note: For real-time updates, use the subscribe_ticker and get_live_ticker tools.*`,
                                },
                            ],
                        };
                    }
                }
                else if (request.params.name === "get_candlesticks") {
                    // get_candlesticks
                    console.error(`[API] Fetching candlesticks for instrument: ${args.instrument}, bar: ${args.bar || "1m"}, limit: ${args.limit || 100}`);
                    const response = await this.axiosInstance.get("/market/candles", {
                        params: {
                            instId: args.instrument,
                            bar: args.bar || "1m",
                            limit: args.limit || 100,
                        },
                    });
                    if (response.data.code !== "0") {
                        throw new Error(`OKX API error: ${response.data.msg}`);
                    }
                    if (!response.data.data || response.data.data.length === 0) {
                        throw new Error("No data returned from OKX API");
                    }
                    // Process the candlestick data
                    const processedData = response.data.data.map(([time, open, high, low, close, vol, volCcy]) => ({
                        timestamp: new Date(parseInt(time)).toISOString(),
                        date: new Date(parseInt(time)).toLocaleString(),
                        open: parseFloat(open),
                        high: parseFloat(high),
                        low: parseFloat(low),
                        close: parseFloat(close),
                        change: (((parseFloat(close) - parseFloat(open)) / parseFloat(open)) *
                            100).toFixed(2),
                        volume: parseFloat(vol),
                        volumeCurrency: parseFloat(volCcy),
                    }));
                    // Reverse for chronological order (oldest first)
                    const chronologicalData = [...processedData].reverse();
                    if (args.format === "json") {
                        // Original JSON format
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: JSON.stringify(processedData, null, 2),
                                },
                            ],
                        };
                    }
                    else if (args.format === "table") {
                        // Table format (still markdown but formatted as a table)
                        let tableMarkdown = `# ${args.instrument} Candlestick Data (${args.bar || "1m"})\n\n`;
                        tableMarkdown +=
                            "| Time | Open | High | Low | Close | Change % | Volume |\n";
                        tableMarkdown +=
                            "|------|------|------|-----|-------|----------|--------|\n";
                        // Only show last 20 entries if there are too many to avoid huge tables
                        const displayData = chronologicalData.slice(-20);
                        displayData.forEach((candle) => {
                            const changeSymbol = parseFloat(candle.change) >= 0 ? "▲" : "▼";
                            tableMarkdown += `| ${candle.date} | $${candle.open.toFixed(2)} | $${candle.high.toFixed(2)} | $${candle.low.toFixed(2)} | $${candle.close.toFixed(2)} | ${changeSymbol} ${Math.abs(parseFloat(candle.change)).toFixed(2)}% | ${candle.volume.toLocaleString()} |\n`;
                        });
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: tableMarkdown,
                                },
                            ],
                        };
                    }
                    else {
                        // Enhanced markdown format with visualization
                        // Calculate some stats
                        const firstPrice = chronologicalData[0]?.open || 0;
                        const lastPrice = chronologicalData[chronologicalData.length - 1]?.close || 0;
                        const overallChange = (((lastPrice - firstPrice) / firstPrice) *
                            100).toFixed(2);
                        const highestPrice = Math.max(...chronologicalData.map((c) => c.high));
                        const lowestPrice = Math.min(...chronologicalData.map((c) => c.low));
                        // Create a simple ASCII chart
                        const chartHeight = 10;
                        const priceRange = highestPrice - lowestPrice;
                        // Get a subset of data points for the chart (we'll use up to 40 points)
                        const step = Math.max(1, Math.floor(chronologicalData.length / 40));
                        const chartData = chronologicalData.filter((_, i) => i % step === 0);
                        // Create the ASCII chart
                        let chart = "";
                        for (let row = 0; row < chartHeight; row++) {
                            const priceAtRow = highestPrice - (row / (chartHeight - 1)) * priceRange;
                            // Price label on y-axis (right aligned)
                            chart += `${priceAtRow.toFixed(2).padStart(8)} |`;
                            // Plot the points
                            for (let i = 0; i < chartData.length; i++) {
                                const candle = chartData[i];
                                if (candle.high >= priceAtRow && candle.low <= priceAtRow) {
                                    // This price level is within this candle's range
                                    if ((priceAtRow <= candle.close && priceAtRow >= candle.open) ||
                                        (priceAtRow >= candle.close && priceAtRow <= candle.open)) {
                                        chart += "█"; // Body of the candle
                                    }
                                    else {
                                        chart += "│"; // Wick of the candle
                                    }
                                }
                                else {
                                    chart += " ";
                                }
                            }
                            chart += "\n";
                        }
                        // X-axis
                        chart += "         " + "‾".repeat(chartData.length) + "\n";
                        // Create the markdown with stats and chart
                        let markdownText = `# ${args.instrument} Candlestick Analysis (${args.bar || "1m"})\n\n`;
                        markdownText += `## Summary\n\n`;
                        markdownText += `- **Period:** ${chronologicalData[0].date} to ${chronologicalData[chronologicalData.length - 1].date}\n`;
                        markdownText += `- **Starting Price:** $${firstPrice.toLocaleString()}\n`;
                        markdownText += `- **Ending Price:** $${lastPrice.toLocaleString()}\n`;
                        markdownText += `- **Overall Change:** ${overallChange}%\n`;
                        markdownText += `- **Highest Price:** $${highestPrice.toLocaleString()}\n`;
                        markdownText += `- **Lowest Price:** $${lowestPrice.toLocaleString()}\n`;
                        markdownText += `- **Number of Candles:** ${chronologicalData.length}\n\n`;
                        markdownText += `## Price Chart\n\n`;
                        markdownText += "```\n" + chart + "```\n\n";
                        markdownText += `## Recent Price Action\n\n`;
                        // Add a table of the most recent 5 candles
                        markdownText += "| Time | Open | High | Low | Close | Change % |\n";
                        markdownText += "|------|------|------|-----|-------|----------|\n";
                        chronologicalData.slice(-5).forEach((candle) => {
                            const changeSymbol = parseFloat(candle.change) >= 0 ? "▲" : "▼";
                            markdownText += `| ${candle.date} | $${candle.open.toFixed(2)} | $${candle.high.toFixed(2)} | $${candle.low.toFixed(2)} | $${candle.close.toFixed(2)} | ${changeSymbol} ${Math.abs(parseFloat(candle.change)).toFixed(2)}% |\n`;
                        });
                        markdownText += `\n*Note: For real-time updates, use the WebSocket subscription tools.*`;
                        return {
                            content: [
                                {
                                    type: "text",
                                    text: markdownText,
                                },
                            ],
                        };
                    }
                }
                // This should never happen due to the check at the beginning
                throw new types_js_1.McpError(types_js_1.ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
            }
            catch (error) {
                if (error instanceof Error) {
                    console.error("[Error] Failed to fetch data:", error);
                    throw new types_js_1.McpError(types_js_1.ErrorCode.InternalError, `Failed to fetch data: ${error.message}`);
                }
                throw error;
            }
        });
    }
    async run() {
        const transport = new stdio_js_1.StdioServerTransport();
        await this.server.connect(transport);
        console.error("OKX MCP server running on stdio");
    }
}
const server = new OKXServer();
server.run().catch(console.error);
