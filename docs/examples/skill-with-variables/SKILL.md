---
name: Example API Skill
description: Example skill demonstrating variable usage
vars:
  - name: API_BASE_URL
    description: Base URL for the API
    required: true
    example: "https://api.example.com"
  - name: API_KEY
    description: API authentication key
    required: true
  - name: ENVIRONMENT
    description: Deployment environment
    required: false
    default: "production"
  - name: TIMEOUT_MS
    description: Request timeout in milliseconds
    required: false
    default: "5000"
---

# Example API Skill

This skill demonstrates how to use variables in skills.

## Configuration

Before using this skill, configure the following variables:

- **API_BASE_URL**: Your API endpoint (e.g., `https://api.example.com`)
- **API_KEY**: Your API authentication key
- **ENVIRONMENT**: Optional, defaults to "production"
- **TIMEOUT_MS**: Optional, defaults to "5000"

## Usage

When making API requests, use the configured values:

```bash
curl -X GET "{{API_BASE_URL}}/users" \
  -H "Authorization: Bearer {{API_KEY}}" \
  -H "X-Environment: {{ENVIRONMENT}}" \
  --max-time {{TIMEOUT_MS}}
```

## Example

```typescript
const response = await fetch('{{API_BASE_URL}}/data', {
  headers: {
    'Authorization': 'Bearer {{API_KEY}}',
    'X-Environment': '{{ENVIRONMENT}}'
  },
  timeout: {{TIMEOUT_MS}}
});
```

## Notes

- All variables are stored securely in encrypted storage
- Required variables must be set before the skill can be used
- Optional variables will use their default values if not set
