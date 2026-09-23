/* Акаунт бота-модератора bot@noxon.local. Пароль — змінна BOT_PASSWORD
   у Vercel. Бот діє як звичайний користувач сайту, тож на нього діють
   правила бази: з роллю адміна він змінює статус заявки, але платежі
   чіпати не може. Роль адміна видає власник на сайті, у блоці «Люди». */
const { signInWithPassword, getDocument, patchDocument } = require("./firestore");

async function botSession(CONFIG, password) {
  if (!password) throw new Error("Немає змінної BOT_PASSWORD.");
  const { apiKey, projectId } = CONFIG.firebase;
  const { idToken, uid } = await signInWithPassword(apiKey, `bot@${CONFIG.loginDomain}`, password);

  // Перший вхід: профіль, як у кожного нового логіна — кредитор.
  let profile = await getDocument(projectId, `users/${uid}`, idToken);
  if (!profile) {
    profile = await patchDocument(projectId, `users/${uid}`,
      { login: "bot", name: "Бот", role: "member", active: true }, idToken, { mustNotExist: true });
  }
  return { idToken, uid, projectId, isAdmin: profile.role === "admin" && profile.active !== false };
}

module.exports = { botSession };
