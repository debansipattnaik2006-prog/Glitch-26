const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
export async function api(path, options = {}) {
  const token = localStorage.getItem('glitch26_admin_token');
  const res = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } });
  const type = res.headers.get('content-type') || '';
  if (!res.ok) { const data = type.includes('json') ? await res.json() : { error: 'Request failed' }; throw new Error(data.error || 'Request failed'); }
  return type.includes('json') ? res.json() : res;
}
export { API };
