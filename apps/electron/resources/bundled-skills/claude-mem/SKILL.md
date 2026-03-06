---
name: claude-mem
description: AI development memory system that provides persistent context across sessions using vector embeddings and semantic search. Automatically captures work history and retrieves relevant context when needed.
---

# Claude-Mem: Persistent Memory for AI Development

## Overview

Claude-mem is a memory system that provides persistent context across your development sessions. It captures what you work on, compresses observations using AI, and injects relevant context into future sessions.

## When to Use

Use this skill when:
- User asks "what did we work on?" or "what happened last time?"
- User references previous work, decisions, or conversations
- User asks about project history or context from past sessions
- User needs to recall specific implementations, debugging sessions, or decisions
- User mentions "I remember we talked about X" or "didn't we fix Y?"

## Architecture

### Core Components
- **5 Lifecycle Hooks**: SessionStart → UserPromptSubmit → PostToolUse → Summary → SessionEnd
- **Database**: SQLite3 at `~/.claude-mem/claude-mem.db`
- **Vector Search**: ChromaDB embeddings for semantic search
- **Worker Service**: Express API on port 37777
- **Viewer UI**: React interface at http://localhost:37777

### Privacy System
Dual-tag system for meta-observation control:
- `content` - User-level privacy control (manual, prevents storage)
- `content` - System-level tag (auto-injected observations, prevents recursive storage)

## How It Works

1. **Capture**: Automatically records tool usage and observations during sessions
2. **Compress**: Uses AI to compress and summarize context
3. **Store**: Saves to SQLite with vector embeddings for semantic search
4. **Retrieve**: Searches and injects relevant context into future sessions

## Configuration

Settings are managed in `~/.claude-mem/settings.json` (auto-created on first run).

## File Locations
- **Database**: `~/.claude-mem/claude-mem.db`
- **Chroma**: `~/.claude-mem/chroma/`
- **Settings**: `~/.claude-mem/settings.json`

## Documentation

Public docs: https://docs.claude-mem.ai

## Search Context

When searching memory:
1. Identify what type of context the user needs (bug fixes, decisions, implementations)
2. Search for relevant past work using semantic queries
3. Present findings with context about when it happened and what was done
4. Offer to dive deeper into specific items if needed

## Requirements
- Node.js
- Bun (auto-installed if missing)
- uv for Python Chroma support (auto-installed if missing)
