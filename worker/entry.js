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
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: 'Not found.' }), {
        status: 404,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response(page(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-cache',
        'content-security-policy': "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' https: data: blob:; connect-src 'self' https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
        'referrer-policy': 'strict-origin-when-cross-origin',
        'x-content-type-options': 'nosniff',
      },
    })
  },
}
