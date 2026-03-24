#!/bin/bash
echo "============================================"
echo "  MCP Grid Desktop Assistant - Setup"
echo "============================================"
echo

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is not installed."
    echo "Install with: sudo apt install python3 python3-pip (Linux)"
    echo "           or: brew install python (macOS)"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
pip3 install -r requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install dependencies."
    echo "Try: pip3 install --user -r requirements.txt"
    exit 1
fi

# Check for .env
if [ ! -f .env ]; then
    echo
    echo "No .env file found. Creating from template..."
    cp .env.example .env
    echo
    echo "IMPORTANT: Edit .env and add your API key:"
    echo "  OPENAI_API_KEY=sk-your-key"
    echo "  or ANTHROPIC_API_KEY=sk-ant-your-key"
    echo
    echo "Edit with: nano .env"
fi

echo
echo "Setup complete! Run: python3 assistant.py"
