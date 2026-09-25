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

function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(v) } };
}

function encodeFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = encodeValue(v);
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

// Вхід звичайним акаунтом (для бота-модератора bot@noxon.local)
async function signInWithPassword(apiKey, email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firebase: вхід ${email} не вдався (${(body.error && body.error.message) || res.status}).`);
  return { idToken: body.idToken, uid: body.localId };
}

// Оновити лише вказані поля; mustNotExist — створити, лише якщо документа ще немає
async function patchDocument(projectId, docPath, fields, idToken, { mustNotExist = false } = {}) {
  const mask = Object.keys(fields).map((k) => "updateMask.fieldPaths=" + encodeURIComponent(k)).join("&");
  const url = `${docsUrl(projectId)}/${docPath}?${mask}${mustNotExist ? "&currentDocument.exists=false" : ""}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + idToken, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(fields) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Firestore: не вдалося записати ${docPath} (${(body.error && body.error.status) || res.status}).`);
    err.status = body.error && body.error.status;
    throw err;
  }
  return decodeDocument(body);
}

// Створити документ, лише якщо його ще немає. true — створено, false — уже був.
// Так позначка «надіслано» працює ще й як замок від дублів.
async function createDocument(projectId, docPath, fields, idToken) {
  try {
    await patchDocument(projectId, docPath, fields, idToken, { mustNotExist: true });
    return true;
  } catch (err) {
    if (err.status === "ALREADY_EXISTS" || err.status === "FAILED_PRECONDITION") return false;
    throw err;
  }
}

async function deleteDocument(projectId, docPath, idToken) {
  const res = await fetch(`${docsUrl(projectId)}/${docPath}`, {
    method: "DELETE",
    headers: { Authorization: "Bearer " + idToken },
  });
  if (res.ok || res.status === 404) return;
  const body = await res.json().catch(() => ({}));
  throw new Error(`Firestore: не вдалося видалити ${docPath} (${(body.error && body.error.status) || res.status}).`);
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

module.exports = {
  decodeFields, decodeDocument, encodeFields,
  signInAnonymously, signInWithPassword,
  listCollection, getDocument, patchDocument, createDocument, deleteDocument,
};
