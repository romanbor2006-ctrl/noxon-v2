/* Firebase для бота — лише через REST: анонімний вхід (як «Увійти як
   гість» на сайті) і читання документів. Правила бази дають гостю
   читати debts і site, тож ключі сервісного акаунта не потрібні. */

function decodeValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields);
  return undefined;
}

function decodeFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

function decodeDocument(doc) {
  return { id: doc.name.split("/").pop(), ...decodeFields(doc.fields) };
}

const docsUrl = (projectId) =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function signInAnonymously(apiKey) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firebase: анонімний вхід не вдався (${(body.error && body.error.message) || res.status}).`);
  return body.idToken;
}

async function readJson(url, idToken, what) {
  const res = await fetch(url, { headers: { Authorization: "Bearer " + idToken } });
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firestore: не вдалося прочитати ${what} (${(body.error && body.error.status) || res.status}).`);
  return body;
}

async function listCollection(projectId, collection, idToken) {
  const out = [];
  let pageToken = "";
  do {
    const url = `${docsUrl(projectId)}/${collection}?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const body = (await readJson(url, idToken, collection)) || {};
    for (const doc of body.documents || []) out.push(decodeDocument(doc));
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return out;
}

async function getDocument(projectId, docPath, idToken) {
  const body = await readJson(`${docsUrl(projectId)}/${docPath}`, idToken, docPath);
  return body ? decodeDocument(body) : null;
}

module.exports = { decodeFields, decodeDocument, signInAnonymously, listCollection, getDocument };
