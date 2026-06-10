exports.handler = async function (event, context) {
  const isLocalDev = process.env.NETLIFY_DEV === 'true';
  const user = context.clientContext?.user;
  if (!isLocalDev && !user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const token  = process.env.GITHUB_TOKEN;
  const owner  = process.env.GITHUB_OWNER;
  const repo   = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || 'main';

  if (!token || !owner || !repo) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Missing required env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO' }),
    };
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  const base = `https://api.github.com/repos/${owner}/${repo}/contents`;

  if (event.httpMethod === 'GET') {
    const path = event.queryStringParameters?.path;
    if (!path) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloudName:    process.env.CLOUDINARY_CLOUD_NAME    || '',
          uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || '',
        }),
      };
    }
    const res = await fetch(`${base}/${path}?ref=${branch}`, { headers });
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await res.json()),
    };
  }

  if (event.httpMethod === 'POST') {
    const body = JSON.parse(event.body || '{}');
    if (body.action === 'cloudinary-delete') {
      const apiKey    = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      if (!apiKey || !apiSecret || !cloudName) {
        return { statusCode: 500, body: JSON.stringify({ error: 'Missing Cloudinary env vars: CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME' }) };
      }
      const publicIds = body.publicIds;
      if (!Array.isArray(publicIds) || publicIds.length === 0) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing publicIds' }) };
      }
      const params = publicIds.map(id => `public_ids[]=${encodeURIComponent(id)}`).join('&');
      const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
      const res = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload?${params}&invalidate=true`,
        { method: 'DELETE', headers: { 'Authorization': `Basic ${auth}` } }
      );
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await res.json()),
      };
    }
    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
  }

  if (event.httpMethod === 'DELETE') {
    const { path, message, sha } = JSON.parse(event.body || '{}');
    if (!path || !message || !sha) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: path, message, sha' }) };
    }
    const payload = { message, sha, branch };
    const res = await fetch(`${base}/${path}`, { method: 'DELETE', headers, body: JSON.stringify(payload) });
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await res.json()),
    };
  }

  if (event.httpMethod === 'PUT') {
    const { path, message, content, sha } = JSON.parse(event.body || '{}');
    if (!path || !message || !content) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: path, message, content' }) };
    }
    const payload = { message, content, branch };
    if (sha) payload.sha = sha;
    const res = await fetch(`${base}/${path}`, { method: 'PUT', headers, body: JSON.stringify(payload) });
    return {
      statusCode: res.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(await res.json()),
    };
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
};
