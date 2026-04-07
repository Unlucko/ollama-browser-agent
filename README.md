# Ollama Browser Agent

AI browser agent Chrome extension powered by local Ollama models. Chat with an AI that can browse the web, interact with pages, read PDFs, and execute multi-step tasks - all running locally on your machine.

Inspired by Claude's browser extension, but using your own local models.

## Features

- Chat interface with plan-and-confirm workflow
- Autonomous browser actions (click, type, navigate, scroll)
- Accessibility tree analysis (like Claude's extension)
- Visual indicators when agent is active (orange glow border)
- PDF/text file upload and analysis
- Loop detection to prevent getting stuck
- Auto tab creation when no webpage is open
- Multiple model support via Ollama

## Requirements

- Chrome or Chromium-based browser
- [Ollama](https://ollama.com) installed and running
- At least one model pulled

## Setup

### 1. Install Ollama

```bash
# macOS
brew install ollama
brew services start ollama

# Or download from https://ollama.com
```

### 2. Pull a model

```bash
# Recommended for best results:
ollama pull qwen2.5:14b

# Lighter alternatives:
ollama pull qwen2.5:7b
ollama pull llama3.1:8b
```

### 3. Configure CORS

Ollama needs to accept requests from the Chrome extension:

```bash
# If using homebrew, add to your plist or:
launchctl setenv OLLAMA_ORIGINS "*"

# Then restart Ollama
brew services restart ollama
```

Or add `OLLAMA_ORIGINS=*` to your Ollama environment config.

### 4. Download pdf.js (for PDF support)

```bash
cd ollama-browser-agent
curl -sL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.124/pdf.min.mjs" -o pdf.min.mjs
curl -sL "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.124/pdf.worker.min.mjs" -o pdf.worker.min.mjs
```

### 5. Load the extension

1. Open `chrome://extensions` in Chrome
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `ollama-browser-agent` folder
5. Click the extension icon on any webpage to open the side panel

## Usage

1. Open any webpage (or the agent will create one for you)
2. Click the extension icon to open the side panel
3. Click **Connect to current tab**
4. Type what you want the agent to do
5. Review the proposed plan
6. Click **Approve & Run** to execute

### Example prompts

- "Search for developer jobs on LinkedIn"
- "Summarize this page for me"
- "Fill out the form on this page"
- "Go to google.com and search for AI news"

### Attach files

Click the paperclip icon to attach PDFs or text files. The agent will extract and analyze the content.

## Model recommendations

| Model | Size | Quality | Use case |
|-------|------|---------|----------|
| qwen2.5:7b | 4.7GB | Basic | Simple tasks (search, click) |
| llama3.1:8b | 4.7GB | Basic | Simple tasks |
| qwen2.5:14b | 9GB | Better | Multi-step tasks |
| qwen2.5:32b | 20GB | Good | Complex navigation |

For truly autonomous complex tasks (like applying to jobs), you'd need 30B+ models or a cloud API (Claude, GPT-4).

## Architecture

- `background.js` - Service worker: Ollama communication, agent loop, tab management
- `sidepanel.html/js` - Chat UI with plan approval workflow
- `accessibility-tree.js` - DOM analysis (adapted from Claude's extension)
- `visual-indicator.js` - Orange glow border when agent is active
- `register-tab.js` - Content script that registers tabs with the background
- `pdf-extract.js` - PDF text extraction using pdf.js

## Limitations

- Local models (7-14B) struggle with complex multi-step tasks
- Cannot interact with browser-internal pages (chrome://)
- Some websites block automated interactions
- No screenshot/vision support (text-only accessibility tree)

## License

MIT
