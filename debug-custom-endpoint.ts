#!/usr/bin/env bun
/**
 * Debug script for custom Anthropic endpoint 403 errors
 *
 * Tests the difference between:
 * 1. Direct curl request (works)
 * 2. App's request with SDK (gets 403)
 */

import { getCredentialManager } from '@work-agent/shared/credentials'
import { getLlmConnection } from '@work-agent/shared/config'

async function testCustomEndpoint(connectionSlug: string) {
  console.log('='.repeat(80))
  console.log('Testing custom Anthropic endpoint configuration')
  console.log('='.repeat(80))

  // Load connection config
  const connection = getLlmConnection(connectionSlug)
  if (!connection) {
    console.error(`❌ Connection not found: ${connectionSlug}`)
    return
  }

  console.log('\n📋 Connection Config:')
  console.log(`  Name: ${connection.name}`)
  console.log(`  Provider: ${connection.providerType}`)
  console.log(`  Auth Type: ${connection.authType}`)
  console.log(`  Base URL: ${connection.baseUrl || '(default)'}`)
  console.log(`  Default Model: ${connection.defaultModel}`)

  // Load credentials
  const credManager = getCredentialManager()
  const apiKey = await credManager.get(`llm::${connectionSlug}::api_key`)

  if (!apiKey) {
    console.error(`\n❌ No API key found for connection: ${connectionSlug}`)
    return
  }

  console.log(`\n🔑 API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`)

  // Test with direct fetch (simulating curl)
  console.log('\n' + '='.repeat(80))
  console.log('Test 1: Direct fetch (simulating curl)')
  console.log('='.repeat(80))

  const baseUrl = connection.baseUrl || 'https://api.anthropic.com'
  const testUrl = `${baseUrl}/v1/messages`

  console.log(`\nURL: ${testUrl}`)
  console.log('Headers:')
  console.log(`  x-api-key: ${apiKey.substring(0, 10)}...`)
  console.log(`  anthropic-version: 2023-06-01`)
  console.log(`  content-type: application/json`)

  try {
    const response = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: connection.defaultModel || 'claude-opus-4-6',
        max_tokens: 10,
        messages: [
          { role: 'user', content: 'Hi' }
        ]
      })
    })

    console.log(`\n✅ Response Status: ${response.status} ${response.statusText}`)

    if (response.status >= 400) {
      const errorText = await response.text()
      console.log(`\n❌ Error Response:`)
      console.log(errorText)
    } else {
      console.log(`\n✅ Request successful!`)
    }
  } catch (error) {
    console.error(`\n❌ Request failed:`, error)
  }

  // Show what the SDK would do
  console.log('\n' + '='.repeat(80))
  console.log('Test 2: SDK Configuration')
  console.log('='.repeat(80))

  console.log('\nEnvironment variables that would be set:')
  console.log(`  ANTHROPIC_BASE_URL=${connection.baseUrl || '(not set)'}`)
  console.log(`  ANTHROPIC_API_KEY=${apiKey.substring(0, 10)}...`)

  console.log('\n⚠️  Potential Issues:')
  console.log('1. SDK subprocess may read OAuth token from macOS Keychain')
  console.log('2. Both x-api-key and Authorization headers may be sent')
  console.log('3. Custom endpoints may reject dual authentication')

  console.log('\n💡 Solution:')
  console.log('The network-interceptor.ts resolveConflictingAuthHeaders() should handle this')
  console.log('Check if ANTHROPIC_API_KEY env var is properly set before SDK starts')
}

// Get connection slug from command line
const connectionSlug = process.argv[2]
if (!connectionSlug) {
  console.error('Usage: bun debug-custom-endpoint.ts <connection-slug>')
  console.error('Example: bun debug-custom-endpoint.ts my-custom-endpoint')
  process.exit(1)
}

testCustomEndpoint(connectionSlug).catch(console.error)
