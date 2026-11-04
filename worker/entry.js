const PAGE_B64 = '__PAGE_BASE64__'
let pageBytes

function page() {
  if (pageBytes) return pageBytes
  const raw = atob(PAGE_B64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index)
  pageBytes = bytes
  return bytes
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname === '/api/assistant' && request.method === 'POST') {
      if (!env.OPENAI_API_KEY) return json({ error: 'The FieldShift Assistant is not connected yet. An administrator must add the OPENAI_API_KEY server secret.' }, 503)
      try {
        const body = await request.json()
        const message = typeof body?.message === 'string' ? body.message.trim() : ''
        const history = Array.isArray(body?.history) ? body.history.slice(-12) : []
        const context = body?.fieldContext && typeof body.fieldContext === 'object' ? body.fieldContext : {}
        if (!message || message.length > 6000) return json({ error: 'Enter a message between 1 and 6,000 characters.' }, 400)
        const input = [
          ...history.map(item => ({ role: item?.role === 'assistant' ? 'assistant' : 'user', content: [{ type: 'input_text', text: String(item?.content || '').slice(0, 6000) }] })),
          { role: 'user', content: [{ type: 'input_text', text: message }] },
        ]
        const system = `You are FieldShift Assistant, a helpful general-purpose AI inside a farm decision-support application. You can answer normal open-ended questions, not only agriculture questions. When field context is supplied, use only those supplied values; explicitly distinguish live weather model data, NASA historical context, and farmer-entered records. Never invent a field value, price, soil result, satellite reading, source, or citation. If the user asks for a high-stakes agricultural, legal, financial, medical, pesticide, or safety decision, give cautious educational information and recommend a qualified local professional. Keep answers clear, warm, and practical.\n\nCurrent FieldShift context (may contain unavailable values):\n${JSON.stringify(context)}`
        const response = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({ model: env.OPENAI_MODEL || 'gpt-4.1-mini', instructions: system, input, max_output_tokens: 900 }),
        })
        const data = await response.json()
        if (!response.ok) return json({ error: data?.error?.message || 'The AI provider could not complete this request.' }, response.status >= 500 ? 502 : response.status)
        const answer = typeof data.output_text === 'string' ? data.output_text.trim() : ''
        if (!answer) return json({ error: 'The AI provider returned no readable answer.' }, 502)
        return json({ answer })
      } catch (error) {
        return json({ error: 'The assistant request could not be completed. Please try again.' }, 502)
      }
    }
    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found.' }, 404)
    }
    return new Response(page(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'content-security-policy': "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
        'referrer-policy': 'strict-origin-when-cross-origin',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
}
