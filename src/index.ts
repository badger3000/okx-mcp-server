#!/usr/bin/env node
import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";

// Define OKX API Response Types
interface OKXTickerResponse {
  code: string;
  msg: string;
  data: Array<{
    instId: string;
    last: string;
    askPx: string;
    bidPx: string;
    open24h: string;
    high24h: string;
    low24h: string;
    volCcy24h: string;
    vol24h: string;
    ts: string;
  }>;
}

interface OKXCandlesticksResponse {
  code: string;
  msg: string;
  data: Array<
    [
      time: string, // Open time
      open: string, // Open price
      high: string, // Highest price
      low: string, // Lowest price
      close: string, // Close price
      vol: string, // Trading volume
      volCcy: string // Trading volume in currency
    ]
  >;
}

class OKXServer {
  private server: Server;
  private axiosInstance;

  constructor() {
    console.error("[Setup] Initializing OKX MCP server...");

    this.server = new Server(
      {
        name: "okx-mcp-server",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.axiosInstance = axios.create({
      baseURL: "https://www.okx.com/api/v5",
      timeout: 5000,
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
    });

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error("[Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_price",
          description:
            "Get latest price for an OKX instrument with formatted visualization",
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
          description:
            "Get candlestick data for an OKX instrument with visualization options",
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
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        if (!["get_price", "get_candlesticks"].includes(request.params.name)) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
        }

        const args = request.params.arguments as {
          instrument: string;
          bar?: string;
          limit?: number;
          format?: string;
        };

        if (!args.instrument) {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Missing required parameter: instrument"
          );
        }

        // Default format to markdown if not specified
        args.format = args.format || "markdown";

        if (request.params.name === "get_price") {
          console.error(
            `[API] Fetching price for instrument: ${args.instrument}`
          );
          const response = await this.axiosInstance.get<OKXTickerResponse>(
            "/market/ticker",
            {
              params: {instId: args.instrument},
            }
          );

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
                  text: JSON.stringify(
                    {
                      instrument: ticker.instId,
                      lastPrice: ticker.last,
                      bid: ticker.bidPx,
                      ask: ticker.askPx,
                      high24h: ticker.high24h,
                      low24h: ticker.low24h,
                      volume24h: ticker.vol24h,
                      timestamp: new Date(parseInt(ticker.ts)).toISOString(),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } else {
            // Enhanced markdown format with visualization elements
            const priceChange =
              parseFloat(ticker.last) - parseFloat(ticker.open24h);
            const priceChangePercent =
              (priceChange / parseFloat(ticker.open24h)) * 100;
            const changeSymbol = priceChange >= 0 ? "▲" : "▼";
            const changeColor = priceChange >= 0 ? "green" : "red";

            // Create price range visual
            const low24h = parseFloat(ticker.low24h);
            const high24h = parseFloat(ticker.high24h);
            const range = high24h - low24h;
            const currentPrice = parseFloat(ticker.last);
            const position =
              Math.min(Math.max((currentPrice - low24h) / range, 0), 1) * 100;

            const priceBar = `Low ${low24h.toFixed(2)} [${"▮".repeat(
              Math.floor(position / 5)
            )}|${"▯".repeat(20 - Math.floor(position / 5))}] ${high24h.toFixed(
              2
            )} High`;

            return {
              content: [
                {
                  type: "text",
                  text:
                    `# ${ticker.instId} Price Summary\n\n` +
                    `## Current Price: $${parseFloat(
                      ticker.last
                    ).toLocaleString()}\n\n` +
                    `**24h Change:** ${changeSymbol} $${Math.abs(
                      priceChange
                    ).toLocaleString()} (${
                      priceChangePercent >= 0 ? "+" : ""
                    }${priceChangePercent.toFixed(2)}%)\n\n` +
                    `**Bid:** $${parseFloat(
                      ticker.bidPx
                    ).toLocaleString()} | **Ask:** $${parseFloat(
                      ticker.askPx
                    ).toLocaleString()}\n\n` +
                    `### 24-Hour Price Range\n\n` +
                    `\`\`\`\n${priceBar}\n\`\`\`\n\n` +
                    `**24h High:** $${parseFloat(
                      ticker.high24h
                    ).toLocaleString()}\n` +
                    `**24h Low:** $${parseFloat(
                      ticker.low24h
                    ).toLocaleString()}\n\n` +
                    `**24h Volume:** ${parseFloat(
                      ticker.vol24h
                    ).toLocaleString()} units\n\n` +
                    `**Last Updated:** ${new Date(
                      parseInt(ticker.ts)
                    ).toLocaleString()}`,
                },
              ],
            };
          }
        } else {
          // get_candlesticks
          console.error(
            `[API] Fetching candlesticks for instrument: ${
              args.instrument
            }, bar: ${args.bar || "1m"}, limit: ${args.limit || 100}`
          );
          const response =
            await this.axiosInstance.get<OKXCandlesticksResponse>(
              "/market/candles",
              {
                params: {
                  instId: args.instrument,
                  bar: args.bar || "1m",
                  limit: args.limit || 100,
                },
              }
            );

          if (response.data.code !== "0") {
            throw new Error(`OKX API error: ${response.data.msg}`);
          }

          if (!response.data.data || response.data.data.length === 0) {
            throw new Error("No data returned from OKX API");
          }

          // Process the candlestick data
          const processedData = response.data.data.map(
            ([time, open, high, low, close, vol, volCcy]) => ({
              timestamp: new Date(parseInt(time)).toISOString(),
              date: new Date(parseInt(time)).toLocaleString(),
              open: parseFloat(open),
              high: parseFloat(high),
              low: parseFloat(low),
              close: parseFloat(close),
              change: (
                ((parseFloat(close) - parseFloat(open)) / parseFloat(open)) *
                100
              ).toFixed(2),
              volume: parseFloat(vol),
              volumeCurrency: parseFloat(volCcy),
            })
          );

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
          } else if (args.format === "table") {
            // Table format (still markdown but formatted as a table)
            let tableMarkdown = `# ${args.instrument} Candlestick Data (${
              args.bar || "1m"
            })\n\n`;
            tableMarkdown +=
              "| Time | Open | High | Low | Close | Change % | Volume |\n";
            tableMarkdown +=
              "|------|------|------|-----|-------|----------|--------|\n";

            // Only show last 20 entries if there are too many to avoid huge tables
            const displayData = chronologicalData.slice(-20);

            displayData.forEach((candle) => {
              const changeSymbol = parseFloat(candle.change) >= 0 ? "▲" : "▼";
              tableMarkdown += `| ${candle.date} | $${candle.open.toFixed(
                2
              )} | $${candle.high.toFixed(2)} | $${candle.low.toFixed(
                2
              )} | $${candle.close.toFixed(2)} | ${changeSymbol} ${Math.abs(
                parseFloat(candle.change)
              ).toFixed(2)}% | ${candle.volume.toLocaleString()} |\n`;
            });

            return {
              content: [
                {
                  type: "text",
                  text: tableMarkdown,
                },
              ],
            };
          } else {
            // Enhanced markdown format with visualization
            // Calculate some stats
            const firstPrice = chronologicalData[0]?.open || 0;
            const lastPrice =
              chronologicalData[chronologicalData.length - 1]?.close || 0;
            const overallChange = (
              ((lastPrice - firstPrice) / firstPrice) *
              100
            ).toFixed(2);
            const highestPrice = Math.max(
              ...chronologicalData.map((c) => c.high)
            );
            const lowestPrice = Math.min(
              ...chronologicalData.map((c) => c.low)
            );

            // Create a simple ASCII chart
            const chartHeight = 10;
            const priceRange = highestPrice - lowestPrice;

            // Get a subset of data points for the chart (we'll use up to 40 points)
            const step = Math.max(1, Math.floor(chronologicalData.length / 40));
            const chartData = chronologicalData.filter(
              (_, i) => i % step === 0
            );

            // Create the ASCII chart
            let chart = "";
            for (let row = 0; row < chartHeight; row++) {
              const priceAtRow =
                highestPrice - (row / (chartHeight - 1)) * priceRange;
              // Price label on y-axis (right aligned)
              chart += `${priceAtRow.toFixed(2).padStart(8)} |`;

              // Plot the points
              for (let i = 0; i < chartData.length; i++) {
                const candle = chartData[i];
                if (candle.high >= priceAtRow && candle.low <= priceAtRow) {
                  // This price level is within this candle's range
                  if (
                    (priceAtRow <= candle.close && priceAtRow >= candle.open) ||
                    (priceAtRow >= candle.close && priceAtRow <= candle.open)
                  ) {
                    chart += "█"; // Body of the candle
                  } else {
                    chart += "│"; // Wick of the candle
                  }
                } else {
                  chart += " ";
                }
              }
              chart += "\n";
            }

            // X-axis
            chart += "         " + "‾".repeat(chartData.length) + "\n";

            // Create the markdown with stats and chart
            let markdownText = `# ${args.instrument} Candlestick Analysis (${
              args.bar || "1m"
            })\n\n`;
            markdownText += `## Summary\n\n`;
            markdownText += `- **Period:** ${chronologicalData[0].date} to ${
              chronologicalData[chronologicalData.length - 1].date
            }\n`;
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
              markdownText += `| ${candle.date} | $${candle.open.toFixed(
                2
              )} | $${candle.high.toFixed(2)} | $${candle.low.toFixed(
                2
              )} | $${candle.close.toFixed(2)} | ${changeSymbol} ${Math.abs(
                parseFloat(candle.change)
              ).toFixed(2)}% |\n`;
            });

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
      } catch (error: unknown) {
        if (error instanceof Error) {
          console.error("[Error] Failed to fetch data:", error);
          throw new McpError(
            ErrorCode.InternalError,
            `Failed to fetch data: ${error.message}`
          );
        }
        throw error;
      }
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("OKX MCP server running on stdio");
  }
}

const server = new OKXServer();
server.run().catch(console.error);
