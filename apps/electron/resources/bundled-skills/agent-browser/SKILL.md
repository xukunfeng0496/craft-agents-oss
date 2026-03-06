---
name: agent-browser
description: A headless browser tool for AI agents to interact with web pages. Navigate landing pages, documentation sites, and web apps programmatically.
---

# Agent Browser

A headless browser tool for AI agents to interact with web pages. Landing pages, documentation sites, web apps - all navigable through this skill.

## What It Does

Agent Browser provides AI agents with the ability to:
- Navigate and interact with web pages programmatically
- Extract content from dynamic JavaScript-rendered pages
- Fill forms, click buttons, and follow links
- Take screenshots of pages
- Scrape data from websites that require JavaScript execution
- Test web applications
- Automate browser workflows

## When to Use

Use this skill when the user needs to:
- Interact with a website that requires JavaScript
- Scrape data from dynamic pages
- Automate form submissions
- Navigate documentation sites
- Test web applications
- Capture screenshots of web pages
- Access content behind login forms
- Interact with single-page applications (SPAs)

## Capabilities

### Navigation
- Navigate to URLs
- Follow links
- Go back/forward in history
- Refresh pages

### Interaction
- Click elements
- Fill forms
- Select dropdowns
- Upload files
- Scroll pages

### Content Extraction
- Extract text content
- Get page metadata
- Extract structured data
- Find elements by CSS selectors
- Extract tables and lists

### Visual
- Take full page screenshots
- Take element screenshots
- Get element positions and sizes
- Check element visibility

## Example Usage

```
# Navigate and extract content
/agent-browser navigate https://example.com
/agent-browser extract "h1, h2, p"
/agent-browser screenshot

# Fill a form
/agent-browser navigate https://example.com/form
/agent-browser fill "#email" "user@example.com"
/agent-browser click "#submit"

# Get page info
/agent-browser info
/agent-browser links
/agent-browser images
```

## Technical Details

Agent Browser uses a headless browser (typically Playwright or Puppeteer) running on localhost to provide full browser capabilities including:
- JavaScript execution
- Cookie management
- Session handling
- Network interception
- Console access

This allows interactions with modern web applications that wouldn't be possible with simple HTTP requests.
