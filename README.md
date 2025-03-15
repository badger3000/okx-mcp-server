# OKX MCP Server

This project creates a Model Context Protocol (MCP) server that fetches real-time cryptocurrency data from the OKX exchange. It allows AI assistants like Claude to access up-to-date cryptocurrency price information and historical data through defined tools with enhanced visualization capabilities and WebSocket live updates.

## Features

- `get_price`: Fetches the latest price data for a cryptocurrency trading pair with visual formatting
- `get_candlesticks`: Retrieves historical candlestick data with visualization options including ASCII charts
- `subscribe_ticker`: Subscribes to real-time WebSocket updates for a trading pair
- `get_live_ticker`: Retrieves the latest live data from WebSocket connection
- `unsubscribe_ticker`: Stops receiving updates for a specific trading pair

## Prerequisites

- Node.js (v16 or higher recommended)
- npm or yarn
- VSCode with Claude extension (if using VSCode integration)
- Claude Desktop (if not using VSCode)

## Installation

1. Clone the repository

   ```bash
   git clone https://github.com/yourusername/okx-mcp-server.git
   cd okx-mcp-server
   ```

2. Install dependencies

   ```bash
   npm install
   ```

3. Add the WebSocket dependency

   ```bash
   npm install ws
   npm install --save-dev @types/ws
   ```

4. Build the project

   ```bash
   npm run build
   ```

5. Make the compiled script executable
   ```bash
   chmod +x build/index.js
   ```

## Usage

### Running the Server Directly

You can run the server directly with:

```bash
npm start
```

Or:

```bash
node build/index.js
```

### Testing with MCP Inspector

To test your MCP server before integration:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

In the inspector, you can test:

- `get_price` with input: `{ "instrument": "BTC-USDT", "format": "markdown" }`
- `get_candlesticks` with input: `{ "instrument": "BTC-USDT", "bar": "1m", "limit": 10, "format": "markdown" }`
- `subscribe_ticker` with input: `{ "instrument": "BTC-USDT" }`
- `get_live_ticker` with input: `{ "instrument": "BTC-USDT", "format": "markdown" }`
- `unsubscribe_ticker` with input: `{ "instrument": "BTC-USDT" }`

Each tool supports different visualization formats:

- `format`: Choose between `markdown`, `json`, or `table` (for candlesticks)

### Integration with VSCode

1. Install the Claude extension for VSCode
2. Configure the MCP server in VSCode settings:

   - Create or edit the following file:
     ```
     ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
     ```
   - Add the following configuration:
     ```json
     {
       "mcpServers": {
         "okx": {
           "command": "node",
           "args": ["/absolute/path/to/okx-mcp-server/build/index.js"],
           "disabled": false,
           "autoApprove": []
         }
       }
     }
     ```
   - Replace `/absolute/path/to/okx-mcp-server/build/index.js` with your actual file path

3. Restart VSCode or reload the Claude extension

### Integration with Claude Desktop

If using Claude Desktop, check their documentation for the appropriate location to place MCP configuration settings.

## Example Prompts

Once integrated, you can ask Claude:

1. "What's the current price of Bitcoin (BTC-USDT)? Show me a nicely formatted display."
2. "Show me the price trend of Ethereum (ETH-USDT) over the last hour using 5-minute intervals with a visual representation."
3. "Compare the current prices of BTC-USDT and ETH-USDT."
4. "Analyze the most recent 20 candlesticks for SOL-USDT with 1-minute intervals and display them in a table format."
5. "Is the current price of BTC-USDT higher or lower than its 24-hour high? Visualize the price range."
6. "Subscribe to live updates for Bitcoin price and tell me when it changes."
7. "Show me the latest real-time data for Ethereum."
8. "Monitor BTC-USDT in real-time and alert me if the price moves by more than 1% in either direction."

## Data Visualization Features

The enhanced MCP server provides rich data visualization:

### Price Data Visualization

- Formatted markdown output with clear price information
- Visual price range bar showing where current price sits between 24h high/low
- Directional indicators (▲/▼) for price changes
- Formatted numbers for better readability

### Candlestick Data Visualization

- **Markdown format**: Includes summary statistics, ASCII chart of price movements, and recent price action table
- **Table format**: Clean tabular presentation of candlestick data
- **JSON format**: Raw data for programmatic use

### Format Options

- **get_price**: Supports `markdown` (default) or `json` formats
- **get_candlesticks**: Supports `markdown` (default), `table`, or `json` formats
- **get_live_ticker**: Supports `markdown` (default) or `json` formats

## WebSocket Real-time Updates

This server includes WebSocket support for receiving live data from OKX:

### How WebSockets Work

- Establishes a persistent connection to OKX's WebSocket API
- Receives push updates whenever prices change
- Maintains a cache of the latest data for each subscribed instrument
- Automatically reconnects if the connection is lost

### WebSocket Tools

- **subscribe_ticker**: Starts a subscription for real-time ticker updates
- **get_live_ticker**: Gets the latest data from active subscriptions
- **unsubscribe_ticker**: Ends a subscription when monitoring is no longer needed

### Use Cases for Real-time Updates

- Monitoring price movements in real-time
- Setting up price alerts
- Tracking market volatility as it happens
- Making informed trading decisions with the latest data

## Environment Variables (Optional)

This basic implementation uses OKX's public API endpoints that don't require authentication. If you extend the server to use authenticated endpoints, you may want to add these environment variables:

```
OKX_API_KEY=your_api_key
OKX_API_SECRET=your_api_secret
OKX_API_PASSPHRASE=your_api_passphrase
```

## Security Notes

- The current implementation only uses public OKX API endpoints, so no API keys are required
- No sensitive data is stored in the codebase
- It's safe to commit this code to Git as is

## Extending the Server

You can extend this MCP server by:

1. Adding more tools for other OKX API endpoints
2. Implementing authenticated endpoints with API keys
3. Adding support for other exchanges
4. Further enhancing the visualizations with more complex charts
5. Adding technical analysis indicators (RSI, MACD, Moving Averages)
6. Implementing price comparison tools for multiple cryptocurrencies
7. Adding market summary features for broader market analysis

## License

MIT
